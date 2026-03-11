// Folder that contains XBEL files.
const bookmarksDir = "./tomsbookmarks/";

// Switch between group mode (true) and icon only mode (false)
// XBEL navigation relies on group mode.
const groupMode = true;

// Text above the search box
const welcomeText = "Startpage!";

const folderIconClass = "fas fa-folder";
const bookmarkIconClass = "fas fa-link";

const rootNode = {
    type: "folder",
    title: "Bookmarks",
    children: []
};

const getDirectChildByTag = (parent, tagName) => {
    const children = toArray(parent ? parent.children : []);
    for (const child of children) {
        if (child.tagName === tagName) {
            return child;
        }
    }

    return null;
};

const safeText = (value, fallback) => {
    const cleaned = (value || "").trim();
    return cleaned.length ? cleaned : fallback;
};

const toArray = (nodeList) => Array.prototype.slice.call(nodeList || []);

const normalizeHref = (href, basePath) => {
    if (!href) {
        return "#";
    }

    try {
        return new URL(href, basePath).toString();
    } catch (err) {
        return href;
    }
};

const isXbelPath = (path) => /\.xbel$/i.test(path || "");

const listXbelFilesFromDirectoryListing = async () => {
    const response = await fetch(bookmarksDir, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`Directory listing failed with HTTP ${response.status}`);
    }

    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const anchors = toArray(doc.querySelectorAll("a"));

    const files = new Set();
    for (const anchor of anchors) {
        const href = (anchor.getAttribute("href") || "").trim();
        if (!href || href === "../") {
            continue;
        }

        const candidate = href.split("?")[0].split("#")[0];
        if (!isXbelPath(candidate)) {
            continue;
        }

        files.add(new URL(candidate, bookmarksDir).pathname.replace(/^\//, ""));
    }

    return toArray(files).map((filePath) => {
        if (filePath.startsWith(bookmarksDir)) {
            return filePath;
        }

        return `${bookmarksDir}${filePath.split("/").pop()}`;
    }).sort();
};

const listXbelFilesFromManifest = async () => {
    const response = await fetch(`${bookmarksDir}index.json`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`Manifest missing or unreadable (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data.files)) {
        throw new Error("Manifest has no files array");
    }

    return data.files
        .map((name) => `${bookmarksDir}${name}`)
        .filter((path) => isXbelPath(path))
        .sort();
};

const listXbelFiles = async () => {
    try {
        const files = await listXbelFilesFromDirectoryListing();
        if (files.length > 0) {
            return files;
        }
    } catch (err) {
        // Fall through to manifest-based loading.
    }

    return listXbelFilesFromManifest();
};

const parseBookmarkNode = (bookmarkEl, basePath) => {
    const titleEl = bookmarkEl.querySelector("title");
    const title = safeText(titleEl ? titleEl.textContent : "", "Untitled");
    const href = normalizeHref(bookmarkEl.getAttribute("href"), basePath);

    return {
        type: "bookmark",
        title,
        href,
        icon: bookmarkIconClass
    };
};

const parseFolderNode = (folderEl, fallbackTitle, basePath) => {
    const titleEl = getDirectChildByTag(folderEl, "title");
    const folder = {
        type: "folder",
        title: safeText(titleEl ? titleEl.textContent : "", fallbackTitle),
        icon: folderIconClass,
        children: []
    };

    const children = toArray(folderEl.children);
    for (const child of children) {
        if (child.tagName === "folder") {
            const nested = parseFolderNode(child, "Group", basePath);
            folder.children.push(nested);
        }

        if (child.tagName === "bookmark") {
            folder.children.push(parseBookmarkNode(child, basePath));
        }
    }

    return folder;
};

const parseXbelDocument = (xmlText, filePath) => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    if (xml.querySelector("parsererror")) {
        throw new Error(`Invalid XML in ${filePath}`);
    }

    const xbel = xml.querySelector("xbel");
    if (!xbel) {
        throw new Error(`Missing <xbel> root in ${filePath}`);
    }

    const xbelTitle = getDirectChildByTag(xbel, "title");
    const topTitle = safeText(
        xbelTitle ? xbelTitle.textContent : "",
        filePath.split("/").pop().replace(/\.xbel$/i, "")
    );

    const topFolder = {
        type: "folder",
        title: topTitle,
        icon: folderIconClass,
        children: []
    };

    const basePath = window.location.href;
    const children = toArray(xbel.children);
    for (const child of children) {
        if (child.tagName === "folder") {
            topFolder.children.push(parseFolderNode(child, "Group", basePath));
        }

        if (child.tagName === "bookmark") {
            topFolder.children.push(parseBookmarkNode(child, basePath));
        }
    }

    return topFolder;
};

const loadTree = async () => {
    const filePaths = await listXbelFiles();

    for (const filePath of filePaths) {
        const response = await fetch(filePath, { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`Could not read ${filePath} (HTTP ${response.status})`);
        }

        const xmlText = await response.text();
        rootNode.children.push(parseXbelDocument(xmlText, filePath));
    }
};

const getPathSegments = () => {
    const params = new URLSearchParams(window.location.search);
    const path = (params.get("path") || "").trim();
    if (!path) {
        return [];
    }

    return path
        .split("/")
        .filter((segment) => /^\d+$/.test(segment))
        .map((segment) => parseInt(segment, 10));
};

const resolveNodeByPath = (segments) => {
    let current = rootNode;
    const trail = [{ node: rootNode, path: [] }];

    for (let i = 0; i < segments.length; i += 1) {
        const index = segments[i];
        const next = (current.children || [])[index];

        if (!next || next.type !== "folder") {
            break;
        }

        const nextPath = segments.slice(0, i + 1);
        trail.push({ node: next, path: nextPath });
        current = next;
    }

    return {
        node: current,
        trail
    };
};

const buildPathUrl = (segments) => {
    const url = new URL(window.location.href);
    if (segments.length === 0) {
        url.searchParams.delete("path");
    } else {
        url.searchParams.set("path", segments.join("/"));
    }

    return `${url.pathname}${url.search}`;
};

const summarizeChildren = (folderNode) => {
    const parts = [];
    const children = folderNode.children || [];

    const groups = children.filter((child) => child.type === "folder").length;
    const links = children.filter((child) => child.type === "bookmark").length;

    if (groups > 0) {
        parts.push(`${groups} Gruppe${groups === 1 ? "" : "n"}`);
    }

    if (links > 0) {
        parts.push(`${links} Link${links === 1 ? "" : "s"}`);
    }

    return parts.join(" • ") || "Leer";
};

const getHostname = (href) => {
    try {
        return new URL(href).hostname;
    } catch (err) {
        return href;
    }
};

const createTile = (tileGrid, tileEntry, config) => {
    const clone = tileEntry.clone();
    const idName = (config.id || config.title).replace(/[^A-Za-z0-9]/g, "x");

    clone.prop("id", `tileEntry${idName}`);
    clone.attr("href", config.href || "#");
    clone.attr("target", config.target || "_self");
    clone.find(".tileIcon").removeClass().addClass(`tileIcon ${config.iconClass}`);
    clone.find(".tileTitle")[0].innerText = config.title;
    clone.find(".tileMeta")[0].innerText = config.meta || "";

    clone.appendTo(tileGrid);
};

const createTileGrid = () => {
    const pathSegments = getPathSegments();
    const resolved = resolveNodeByPath(pathSegments);
    const currentNode = resolved.node;

    const tileGrid = $("#tileGrid");
    const tileEntry = $("#tileEntry");

    const children = currentNode.children || [];
    const items = children.map((child, idx) => ({ child, idx }));

    if (pathSegments.length > 0) {
        createTile(tileGrid, tileEntry, {
            id: `up-${pathSegments.join("-")}`,
            title: "..",
            meta: "Eine Ebene hoch",
            iconClass: "fas fa-level-up-alt",
            href: buildPathUrl(pathSegments.slice(0, -1)),
            target: "_self"
        });
    }

    for (const item of items) {
        const child = item.child;
        const isFolder = child.type === "folder";
        const href = isFolder ? buildPathUrl(pathSegments.concat([item.idx])) : child.href;
        const meta = isFolder ? summarizeChildren(child) : getHostname(child.href);

        createTile(tileGrid, tileEntry, {
            id: `${pathSegments.join("-")}-${item.idx}-${child.title}`,
            title: child.title,
            meta,
            iconClass: isFolder ? folderIconClass : bookmarkIconClass,
            href,
            target: "_self"
        });
    }

    tileEntry.remove();

    const breadcrumb = resolved.trail.map((item) => item.node.title).join(" / ");
    $(".welcomeText")[0].innerText = `${welcomeText} ${breadcrumb ? "- " + breadcrumb : ""}`;
};

const showError = (message) => {
    $("#tileGrid").html(`<div class=\"alert alert-danger\" role=\"alert\">${message}</div>`);
};

$(async function () {
    $(".welcomeText")[0].innerText = welcomeText;

    if (!groupMode) {
        showError("groupMode muss bei XBEL-Navigation auf true stehen.");
        return;
    }

    try {
        await loadTree();
        createTileGrid();
    } catch (err) {
        showError(`XBEL konnte nicht geladen werden: ${err.message}`);
    }
});
