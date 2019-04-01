let style  = document.createElement("link");
style.id = "scrapyard-archive-edit-css";
style.rel = "stylesheet";
style.type = "text/css";
style.href = browser.runtime.getURL("edit.css");

document.head.appendChild(style);


script = document.createElement("script");
script.id = "scrapyard-archive-proto";
script.src = browser.runtime.getURL("proto.js");

document.head.appendChild(script);


script = document.createElement("script");
script.id = "scrapyard-archive-jquery";
script.src = browser.runtime.getURL("lib/jquery.js");

script.addEventListener("load", e => {
    script = document.createElement("script");
    script.id = "scrapyard-archive-edit";
    script.src = browser.runtime.getURL("edit-content.js");

    document.head.appendChild(script);
});

document.head.appendChild(script);

function receiveMessage(event) {
    if (event.data.type === "UPDATE_ARCHIVE") {
        let doc = document.documentElement.cloneNode(true)
        let bar = doc.querySelector(".scrapyard-edit-bar");

        if (bar)
            bar.parentNode.removeChild(bar);

        browser.runtime.sendMessage({
            type: 'UPDATE_ARCHIVE',
            id: parseInt(location.hash.split(":")[1]),
            data: "<!DOCTYPE html>" + doc.outerHTML
        });
    }
}

window.addEventListener("message", receiveMessage, false);

null;
