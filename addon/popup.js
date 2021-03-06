import {
    DEFAULT_SHELF_NAME, NODE_TYPE_GROUP, NODE_TYPE_SHELF,
    NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK, FIREFOX_SHELF_ID, FIREFOX_BOOKMARK_UNFILED, RDF_EXTERNAL_NAME
} from "./db.js";
import {BookmarkTree} from "./tree.js";
import {backend} from "./backend.js";

let tree;

function withCurrTab(fn) {
    return browser.tabs.query({currentWindow: true, active: true}).then(function (tabs) {
        fn.apply(null, [tabs[0]]);
    });
}

function saveHistory(node, history) {
    if (node) {
        let folder_history = history.slice(0);
        let existing = folder_history.find(h => h.id == node.original.id);

        if (existing)
            folder_history.splice(folder_history.indexOf(existing), 1);

        folder_history = [{id: node.original.id, text: node.text}, ...folder_history].slice(0, 10);
        localStorage.setItem("popup-folder-history", JSON.stringify(folder_history));
    }
}

window.onload = function () {

    let folder_history;

    tree = new BookmarkTree("#treeview", true);

    $("#bookmark-folder").selectric({inheritOriginalWidth: true});

    backend.listGroups().then(nodes => {
        $("#bookmark-folder").html("");

        nodes = nodes.filter(n => n.external !== RDF_EXTERNAL_NAME);

        folder_history = localStorage.getItem("popup-folder-history");

        if (folder_history != null && folder_history !== "null") {
            folder_history = JSON.parse(folder_history).filter(h => nodes.some(n => n.id == h.id));

            if (folder_history && folder_history.length) {
                for (let item of folder_history) {
                    $("#bookmark-folder").append(`<option class='folder-label' value='${item.id}'>${item.text}</option>`)
                }
            }
        }

        if (!folder_history || folder_history === "null" || !folder_history.length) {
            folder_history = [];
            $("#bookmark-folder").append(`<option class='folder-label' value='1'>${DEFAULT_SHELF_NAME}</option>`)
        }

        $("#bookmark-folder").selectric("refresh");

        tree.update(nodes);
    });


    withCurrTab((tab) => {
        $("#bookmark-name").val(tab.title);
        $("#bookmark-url").val(tab.url);

        browser.tabs.executeScript(tab.id, {
            code: `var iconElt = document.querySelector("head link[rel*='icon'], head link[rel*='shortcut']");
                   iconElt? iconElt.href: null;
            `}).then(icon => {
                if (icon && icon.length && icon[0]) {
                    let icon_url = new URL(icon[0], new URL(tab.url).origin);
                    $("#bookmark-icon").val(icon_url.toString());
                }
                else {
                    let favicon = new URL(tab.url).origin + "/favicon.ico";
                    fetch(favicon, {method: "GET"})
                        .then(response => {
                            let type = response.headers.get("content-type") || "image";
                            if (response.ok && type.startsWith("image"))
                                return response.arrayBuffer().then(bytes => {
                                    if (bytes.byteLength)
                                        $("#bookmark-icon").val(favicon.toString());
                                });
                    })
                }
            }).catch(e => {
                console.log(e)
            });
    });

    $("#bookmark-tags").focus();

    $("#treeview").on("select_node.jstree", (e, {node}) => {
        let existing = $(`#bookmark-folder option[value='${node.original.id}']`);

        if (!existing.length) {
            $("#bookmark-folder option[data-tentative='true']").remove();
            $("#bookmark-folder").prepend(`<option  class='folder-label'  data-tentative='true' selected value='${node.original.id}'>${node.text}</option>`)
            $("#bookmark-folder").selectric("refresh");
        }

        $("#bookmark-folder").val(node.original.id);
        $("#bookmark-folder").selectric("refresh");
    });

    $("#bookmark-folder").on("change", (e) => {
        let id = $("#bookmark-folder").val();
        tree._jstree.deselect_all(true);
        tree._jstree.select_node(id);
        document.getElementById(id).scrollIntoView();
    });

    $("#new-folder").on("click", () => {
        let selected_node = tree.selected;
        let node = tree._jstree.create_node(selected_node, {
            id: "$new_node$",
            text: "New Folder",
            type: NODE_TYPE_GROUP,
            icon: "icons/group.svg",
            li_attr: {"class": "scrapyard-group"}
        });

        tree._jstree.deselect_all();
        tree._jstree.select_node(node);

        tree._jstree.edit(node, null, (node, success, cancelled) => {
            if (cancelled) {
                tree._jstree.delete_node(node);
            }
            else {
                backend.createGroup(selected_node.original.id, node.text).then(group => {
                    if (group) {
                        tree._jstree.set_id(node, group.id);
                        node.original = group;
                        BookmarkTree.toJsTreeNode(group);
                        BookmarkTree.reorderNodes(tree._jstree, selected_node);

                        let new_option = $(`#bookmark-folder option[value='$new_node$']`);
                        new_option.text(group.name);
                        new_option.val(node.id);
                        $("#bookmark-folder").val(node.id);
                        $("#bookmark-folder").selectric("refresh");
                    }
                });
            }
        });
    });

    function addBookmark(node_type) {
        let parent_node = tree._jstree.get_node($("#bookmark-folder").val());

        if (parent_node.original.id === FIREFOX_SHELF_ID) {
            let unfiled = tree.data.find(n => n.external_id === FIREFOX_BOOKMARK_UNFILED)
            if (unfiled)
                parent_node = tree._jstree.get_node(unfiled.id);
            else
                parent_node = tree._jstree.get_node(tree.data.find(n => n.name === DEFAULT_SHELF_NAME).id);
        }

        saveHistory(parent_node, folder_history);
        browser.runtime.sendMessage({type: node_type === NODE_TYPE_BOOKMARK
                                            ? "CREATE_BOOKMARK"
                                            : "CREATE_ARCHIVE",
                                     data: {
                                        name: $("#bookmark-name").val(),
                                        uri:  $("#bookmark-url").val(),
                                        tags: $("#bookmark-tags").val(),
                                        icon: $("#bookmark-icon").val(),
                                        parent_id: parseInt(parent_node.id)
                                    }});
    }

    $("#create-bookmark").on("click", (e) => {
        addBookmark(NODE_TYPE_BOOKMARK);
        window.close();
    });

    $("#create-archive").on("click", (e) => {
        addBookmark(NODE_TYPE_ARCHIVE);
        window.close();
    });
};

console.log("==> popup.js loaded");
