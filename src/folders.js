"use strict";

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const St = imports.gi.St;


const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var FolderList = class extends PopupMenu.PopupMenuSection {
    constructor(menu, api) {
        super();
        this._menu = menu;
        this._api = api;
        this.folder_ids = [];
        // this.folders is a Map() that maps: (id: String) -> menuitem: FolderMenuItem
        this.folders = new Map();
        this._folderAddedNotifyId = this._api.connect("folder-added", this._addFolder.bind(this));
        this._folderRemovedNotifyId = this._api.connect("folder-removed", this._removeFolder.bind(this));
    }

    _addFolder(session, folder) {
        let id = folder.id;
        let position = this._sortedIndex(id);
        this.folder_ids.splice(position, 0, id);
        let menuitem = new FolderMenuItem(folder);
        this.addMenuItem(menuitem, position);
        this.folders.set(id, menuitem);
        this._menu.notifyListChanged();
    }

    _removeFolder(session, folder) {
        let id = folder.id;
        let position = this.folder_ids.indexOf(id);
        let removed = this.folder_ids.splice(position, 1);
        let menuitem = this.folders.get(removed[0]);
        menuitem.destroy();
        this.folders.delete(id);
        this._menu.notifyListChanged();
    }

    /* http://stackoverflow.com/a/21822316/3472468 */
    _sortedIndex(value) {
        let low = 0,
            high = this.folder_ids.length;

        while (low < high) {
            let mid = (low + high) >>> 1;
            if (this.folder_ids[mid] < value) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    destroy() {
        if (this._folderAddedNotifyId > 0) {
            this._api.disconnect(this._folderAddedNotifyId);
        }
        if (this._folderRemovedNotifyId > 0) {
            this._api.disconnect(this._folderRemovedNotifyId);
        }
        this._api = null;
        super.destroy();
    }
}


function getFolderStatusIcon(iconName) {
    let path = Me.dir.get_path() + "/icons/hicolor/scalable/status/" + iconName + ".svg";
    let gicon = Gio.icon_new_for_string(path);
    return gicon;
}


var FolderMenuItem = GObject.registerClass(
class FolderMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(folder) {
        super._init();
        this.folder = folder;
        this._icon = new St.Icon({ gicon: this._getIcon(folder.path),
                                   style_class: "popup-menu-icon" });
        this.actor.add_child(this._icon);

        this._label = new St.Label({ text: folder.label });
        this.actor.add_child(this._label);
        this.actor.label_actor = this._label;

        this._label_state = new St.Label({ style_class: "folder-progress-text",
                                           x_expand: true,
                                           x_align: Clutter.ActorAlign.END,
                                           y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this._label_state);
        this._statusIcon = new St.Icon({ style_class: "folder-status-icon" });
        this.actor.add_child(this._statusIcon);

        this._folderStateChangedNotifyId = this.folder.connect("state-changed", this._folderStateChanged.bind(this));
        this._folderLabelChangedNotifyId = this.folder.connect("label-changed", this._folderLabelChanged.bind(this));
        this._folderPathChangedNotifyId = this.folder.connect("path-changed", this._folderPathChanged.bind(this));
    }

    _getIcon(path) {
        if (! path) {
            return new Gio.ThemedIcon({ name: "folder-symbolic" });
        }
        let file = Gio.File.new_for_path(path);
        try {
            let query_info = file.query_info("standard::symbolic-icon", 0, null);
            return query_info.get_symbolic_icon();
        } catch(e) {
            if (e instanceof Gio.IOErrorEnum) {
              // return a generic icon
              if (!file.is_native())
                return new Gio.ThemedIcon({name: "folder-remote-symbolic"});
              else
                return new Gio.ThemedIcon({name: "folder-symbolic"});
            } else {
                throw e;
            }
        }
    }

    activate(event) {
        let path = this.folder.path;
        if (! path)
            return;
        if (path.startsWith("~/")) {
            path = "./" + path.substring(2);
        }
        let uri = Gio.File.new_for_path(path).get_uri();
        let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri(uri, launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch URI “%s”").format(uri), e.message);
        }

        super.activate(event);
    }

    _folderPathChanged(folder, path) {
        this._icon.gicon = this._getIcon(path);
    }

    _folderLabelChanged(folder, label) {
        this._label.text = label;
    }

    _folderStateChanged(folder, state, pct) {
        switch (state) {
            case "idle":
                let label = (pct == 100) ? "" : "%d\u2009%%".format(pct);
                this._label_state.set_text(label);
                this._statusIcon.visible = false;
                this._statusIcon.gicon = null;
                break;
            case "scanning":
                this._label_state.set_text("");
                this._statusIcon.visible = true;
                this._statusIcon.gicon = getFolderStatusIcon("database");
                break;
            case "syncing":
                this._label_state.set_text("%d\u2009%%".format(pct));
                this._statusIcon.visible = true;
                this._statusIcon.gicon = getFolderStatusIcon("cloud-down");
                break;
            case "error":
                this._label_state.set_text("");
                this._statusIcon.visible = true;
                this._statusIcon.gicon = getFolderStatusIcon("exclamation-triangle");
                break;
            case "unknown":
                this._label_state.set_text("");
                this._statusIcon.visible = true;
                this._statusIcon.gicon = getFolderStatusIcon("question");
                break;
            default:
                myLog(`unknown syncthing folder state: ${state}`);
                this._label_state.set_text("");
                this._statusIcon.visible = true;
                this._statusIcon.gicon = getFolderStatusIcon("question");
        }
    }

    destroy() {
        if (this._folderStateChangedNotifyId > 0) {
            this.folder.disconnect(this._folderStateChangedNotifyId);
        }
        if (this._folderLabelChangedNotifyId > 0) {
            this.folder.disconnect(this._folderLabelChangedNotifyId);
        }
        if (this._folderPathChangedNotifyId > 0) {
            this.folder.disconnect(this._folderPathChangedNotifyId);
        }
        this.folder = null;
        super.destroy();
    }
});

