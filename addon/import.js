import * as org from "./lib/org.js"
import {backend} from "./backend.js"
import LZString from "./lib/lz-string.js"
import {
    NODE_TYPE_SHELF, NODE_TYPE_GROUP, NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK, DEFAULT_POSITION, TODO_STATES, TODO_NAMES
} from "./db.js";

const ORG_EXPORT_VERSION = 1;
const EXPORTED_KEYS = ["uuid", "icon", "type", "date_added", "date_modified"];

function traverseOrgNode(node, callback) {
    callback(node);
    if (node.children.length)
        for (let c of node.children)
            traverseOrgNode(c, callback);
}

export async function importOrg(shelf, text) {
    let org_lines = new org.Parser().parse(text);

    let path = [shelf];
    let level = 0;

    let last_object;

    async function importLastObject() {
        if (last_object) {
            let data = last_object.data;
            delete last_object.data;

            let index = last_object.index;
            delete last_object.index;

            // UUIDs currently aren't respected

            if (last_object.type === NODE_TYPE_ARCHIVE) {
                let node = await backend.importBookmark(last_object);

                await backend.storeBlob(node.id, data, last_object.mime_type);
                await backend.storeIndex(node.id, index);
            }
            else {
                await backend.importBookmark(last_object);
            }

            last_object = null;
        }
    }

    for (let line of org_lines.nodes) {
        let subnodes = [];
        traverseOrgNode(line, n => subnodes.push(n));
        subnodes = subnodes.filter(n => !(n.type === "inlineContainer"
            || n.type === "text" && !n.value));

        if (subnodes[0].type === "header" && subnodes.some(n => n.type === "link")) {
            await importLastObject();

            if (level >= subnodes[0].level) {
                while (level >= subnodes[0].level) {
                    path.pop();
                    level -= 1;
                }
            }

            let link = subnodes.find(n => n.type === "link");
            let index = subnodes.indexOf(link);

            last_object = {
                uri: link.src,
                name: subnodes[index + 1].value,
                type: NODE_TYPE_BOOKMARK,
                pos: DEFAULT_POSITION,
                path: path.join("/")
            };

            if (subnodes[1].type === "text") {
                let todo = subnodes[1].value.trim().toUpperCase();
                if (TODO_STATES[todo])
                    last_object.todo_state = TODO_STATES[todo];
            }

            if (subnodes[subnodes.length - 1].type === "text"
                    && subnodes[subnodes.length - 1].value.indexOf(":") >= 0) {

                last_object.tags = subnodes[subnodes.length - 1].value.trim()
                    .split(":")
                    .map(t => t.trim())
                    .filter(t => !!t)
                    .join(",");
            }
        }
        else if (subnodes.length > 1 && subnodes[0].type === "header" && subnodes[1].type === "text") {
            await importLastObject();

            if (level < subnodes[0].level) {
                level += 1;
                path.push(subnodes[1].value);
            }
            else {
                while (level >= subnodes[0].level) {
                    path.pop();
                    level -= 1;
                }
                level += 1;
                path.push(subnodes[1].value);
            }
        }
        else if (subnodes[0].type === "drawer" && subnodes[0].name === "PROPERTIES") {
            subnodes.shift();

            if (last_object) {
                for (let property of subnodes) {
                    switch (property.name) {
                        case "pos":
                            break;
                        case "type":
                        case "todo_pos":
                        case "todo_state":
                            last_object[property.name] = parseInt(property.value);
                            break;
                        case "date_added":
                        case "date_modified":
                            last_object[property.name] = new Date(property.value);
                            break;
                        default:
                            last_object[property.name] = property.value;
                    }
                }

                if (last_object.type === NODE_TYPE_ARCHIVE) {
                    let compressed = last_object["compressed"];

                    if (last_object.data)
                        last_object.data = compressed
                            ? LZString.decompressFromBase64(last_object.data).trim()
                            : decodeURIComponent(escape(window.atob(last_object.data)));

                    if (last_object.index) {
                        let index_json = compressed
                            ? LZString.decompressFromBase64(last_object.index).trim()
                            : decodeURIComponent(escape(window.atob(last_object.index)));

                        if (index_json)
                            last_object.index = JSON.parse(index_json);
                    }
                }
            }
        }
        else if (subnodes[0].type === "text" && /\s*DEADLINE:.*/.test(subnodes[0].value)) {
            let match = /\s*DEADLINE:\s*<([^>]+)>/.exec(subnodes[0].value);

            if (match && match[1] && last_object)
                last_object["todo_date"] = match[1];
        }
    }

    await importLastObject();
}

async function objectToProperties(node, compress) {
    let lines = [];

    node = await backend.getNode(node.id);

    for (let key of EXPORTED_KEYS) {
        if (node[key])
            lines.push(`    :${key}: ${node[key]}`);
    }

    if (node.type === NODE_TYPE_ARCHIVE) {
        let blob = await backend.fetchBlob(node.id);
        if (blob) {
            if (blob && blob.type)
                lines.push(`    :mime_type: ${blob.type}`);

            let content;

            if (compress) {
                lines.push(`    :compressed: ${compress}`);
                content = LZString.compressToBase64(blob.data);
            }
            else
                content = btoa(unescape(encodeURIComponent(blob.data)));

            lines.push(`    :data: ${content}`);
        }

        let index = await backend.fetchIndex(node.id);
        if (index)
            if (compress)
                lines.push(`    :index: ${LZString.compressToBase64(JSON.stringify(index.words))}`);
            else
                lines.push(`    :index: ${btoa(unescape(encodeURIComponent(JSON.stringify(index.words))))}`);
    }

    return lines.join("\n");
}

export async function exportOrg(nodes, shelf, uuid, shallow = false, compress = true) {
    let org_lines = [];

    if (!shallow)
        org_lines.push(
`#EXPORT: Scrapyard
#VERSION: ${ORG_EXPORT_VERSION}
#NAME: ${shelf}
${"#UUID: " + uuid}
`);

    org_lines.push("#+TODO: TODO WAITING POSTPONED | DONE CANCELLED\n");

    for (let node of nodes) {
        if (node.type === NODE_TYPE_SHELF || node.type === NODE_TYPE_GROUP) {
            let line = "\n" + "*".repeat(node.level) + " " + node.name;
            org_lines.push(line);
        }
        else {
            let line = "\n" + "*".repeat(node.level);

            if (node.todo_state)
                line += " " + TODO_NAMES[node.todo_state];

            line += " [[" + (node.uri? node.uri: "") + "][" + node.name + "]]";

            if (node.tags) {
                let tag_list = node.tags.split(",").map(t => t.trim());
                line += "    :" + tag_list.join(":") + ":";
            }

            if (node.todo_date)
                line += "\n    DEADLINE: <" + node.todo_date + ">";

            org_lines.push(line);
        }

        if (!shallow) {
            let props = `
:PROPERTIES:
${await objectToProperties(node, compress)}
:END:`;
            org_lines.push(props);
        }
    }

    let blob = new Blob(org_lines, { type : "text/plain" });
    let url = URL.createObjectURL(blob);

    setTimeout(function() {
        window.URL.revokeObjectURL(url);
    },100);

    return url;
}
