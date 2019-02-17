"use strict";

const Config = imports.misc.config;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Soup = imports.gi.Soup;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;


const GETTEXT_DOMAIN = "gnome-shell-extension-syncthing";
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Settings = Convenience.getSettings();
const Filewatcher = Me.imports.filewatcher;
const SyncthingApi = Me.imports.syncthing_api;
const Systemd = Me.imports.systemd;

function myLog(msg) {
    log(`[syncthingicon] ${msg}`);
}

const FolderList = new Lang.Class({
    Name: "FolderList",
    Extends: PopupMenu.PopupMenuSection,

    _init(api) {
        this.parent();
        this._api = api;
        this.folder_ids = [];
        // this.folders is a Map() that maps: (id: String) -> menuitem: FolderMenuItem
        this.folders = new Map();
        this._folderAddedNotifyId = this._api.connect("folder-added", this._addFolder.bind(this));
        this._folderRemovedNotifyId = this._api.connect("folder-removed", this._removeFolder.bind(this));
    },

    _addFolder(session, folder) {
        let id = folder.id;
        let position = this._sortedIndex(id);
        this.folder_ids.splice(position, 0, id);
        let menuitem = new FolderMenuItem(folder);
        this.addMenuItem(menuitem, position);
        this.folders.set(id, menuitem);
    },

    _removeFolder(session, folder) {
        let id = folder.id;
        let position = this.folder_ids.indexOf(id);
        let removed = this.folder_ids.splice(position, 1);
        let menuitem = this.folders.get(removed[0]);
        menuitem.destroy();
        this.folders.delete(id);
    },

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
    },

    destroy() {
        if (this._folderAddedNotifyId > 0) {
            this._api.disconnect(this._folderAddedNotifyId);
        }
        if (this._folderRemovedNotifyId > 0) {
            this._api.disconnect(this._folderRemovedNotifyId);
        }
        this._api = null;
        this.parent();
    },
});

const FolderMenuItem = new Lang.Class({
    Name: "FolderMenuItem",
    Extends: PopupMenu.PopupBaseMenuItem,

    _init(folder) {
        this.parent();
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
    },

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
    },

    activate(event) {
        let path = this.folder.path;
        if (! path)
            return;
        let uri = Gio.File.new_for_path(path).get_uri();
        let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri(uri, launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch URI “%s”").format(uri), e.message);
        }

        this.parent(event);
    },

    _folderPathChanged(folder, path) {
        this._icon.gicon = this._getIcon(path);
    },

    _folderLabelChanged(folder, label) {
        this._label.text = label;
    },

    _folderStateChanged(folder, state) {
        if (state === "idle") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = "";
        } else if (state === "scanning") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = "database";
        } else if (state === "syncing") {
            let pct = this._syncPercentage(model);
            this._label_state.set_text("%d\u2009%%".format(pct));
            this._statusIcon.icon_name = "exchange";
        } else if (state === "error") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = "exclamation-triangle";
        } else if (state === "unknown") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = "question";
        } else {
            myLog(`unknown syncthing folder state: ${state}`);
            this._label_state.set_text("");
            this._statusIcon.icon_name = "question";
        }
    },

    _syncPercentage(model) {
        if (model.globalBytes === 0)
            return 100;
        return Math.floor(100 * model.inSyncBytes / model.globalBytes);
    },

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
        this.parent();
    },
});


const SyncthingMenu = new Lang.Class({
    Name: "SyncthingMenu",
    Extends: PanelMenu.Button,

    _init() {
        this.parent(0.0, "Syncthing", false);

        this._api = new SyncthingApi.SyncthingSession();
        this._systemd = new Systemd.Control(64);

        this._initButton();
        this._initMenu();

        this.api_state = "disconnected";
        this._api.connect("connection-state-changed", this._onApiStateChanged.bind(this));

        this.systemd_state = "systemd-not-available";
        this._systemd.connect("state-changed", this._onSystemdStateChanged.bind(this));
        this._systemd.update();

        this.menu.connect("open-state-changed", this._menuOpenStateChanged.bind(this));

        Settings.connect("changed", this._onSettingsChanged.bind(this));
        this._onSettingsChanged();
    },

    _initButton() {
        let box = new St.BoxLayout();
        this.actor.add_child(box);

        this._syncthingIcon = new St.Icon({ icon_name: "syncthing-symbolic",
                                          style_class: "system-status-icon syncthing-logo-icon" });
        box.add_child(this._syncthingIcon);

        this._statusIcon = new St.Icon({ style_class: "system-status-icon syncthing-status-icon" });
        box.add_child(this._statusIcon);

        this.status_label = new St.Label({ style: "font-size: 70%;",
                                         y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.status_label);
    },

    _initMenu() {
        // 1. Syncthing On/Off Switch
        this.item_switch = null;

        // 2. Web Interface Button
        let icon = (parseFloat(Config.PACKAGE_VERSION.substr(0, Config.PACKAGE_VERSION.indexOf(".", 3))) < 3.26) ?
            "emblem-system-symbolic"
            : new Gio.ThemedIcon({ name: "emblem-system-symbolic" });

        this.item_config = new PopupMenu.PopupImageMenuItem(_("Web Interface"), icon);
        this.item_config.connect("activate", this._onConfig.bind(this));
        this.menu.addMenuItem(this.item_config);
        this.item_config.setSensitive(false);

        // 3. Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Folder List
        this.folder_list = new FolderList(this._api);
        this.menu.addMenuItem(this.folder_list);
    },

    _menuOpenStateChanged(menu, open) {
        if (open) {
            // When the menu is open, we want to get quick updates.
            this._systemd.setUpdateInterval(1, 8);
            this._api.setUpdateInterval(1, 8);
        } else {
            // When the menu is closed, we can wait longer.
            this._systemd.setUpdateInterval(8, 64);
            this._api.setUpdateInterval(8, 64);
        }
    },

    _onSettingsChanged(settings, key) {
        this.externalBrowser = Settings.get_boolean("external-browser");

        if (Settings.get_boolean("autoconfig")) {
            if (! this._configFileWatcher) {
                this._onAutoConfigChanged(null);
                let configfile = Filewatcher.probeDirectories();
                if (configfile !== null) {
                    this._configFileWatcher = new Filewatcher.ConfigFileWatcher(this._onAutoConfigChanged.bind(this), configfile);
                }
            }
        } else {
            if (this._configFileWatcher) {
                this._configFileWatcher.destroy();
                this._configFileWatcher = null;
            }
            this.baseURI = Settings.get_string("configuration-uri");
            this.apikey = Settings.get_string("api-key");
        }

        this._api.setParams(this.baseURI, this.apikey);
    },

    _onAutoConfigChanged(config) {
        if (config === null) {
            this.baseURI = Settings.get_default_value("configuration-uri").unpack();
            this.apikey = Settings.get_default_value("api-key").unpack();
        } else {
            this.baseURI = config["uri"] || Settings.get_default_value("configuration-uri").unpack();
            this.apikey = config["apikey"];
        }

        this._api.setParams(this.baseURI, this.apikey);
    },

    _onConfig(actor, event) {
        if (!this.externalBrowser && this.baseURI.startsWith("http://")) {
            this._openWebView();
        } else {
            let launchContext = global.create_app_launch_context(event.get_time(), -1);
            try {
                Gio.AppInfo.launch_default_for_uri(this.baseURI, launchContext);
            } catch(e) {
                Main.notifyError(_("Failed to launch URI “%s”").format(this.baseURI), e.message);
            }
        }
    },

    _openWebView() {
        let working_dir = Me.dir.get_path();
        let [ok, pid] = GLib.spawn_async(working_dir, ["gjs", "webviewer.js"], null, GLib.SpawnFlags.SEARCH_PATH, null);
        GLib.spawn_close_pid(pid);
    },

    _onSwitch(actor, event) {
        if (actor.state) {
            this._systemd.startService();
            this._systemd.setUpdateInterval(1, 8);
        } else {
            this._systemd.stopService();
            this._systemd.setUpdateInterval(1, 64);
        }
        this._systemd.update();
    },

    _onSystemdStateChanged(control, state) {
        switch (state) {
            case "systemd-not-available":
            case "unit-not-loaded":
                myLog("systemd user unit “syncthing.service” not loaded");
                if (this.item_switch !== null) {
                    this.item_switch.disconnect(this._switchNotifyId);
                    this.item_switch.destroy();
                    this.item_switch = null;
                }
                this._api.start();
                break;
            case "inactive":
            case "active":
                if (this.item_switch === null) {
                    this.item_switch = new PopupMenu.PopupSwitchMenuItem("Syncthing", false, null);
                    this._switchNotifyId = this.item_switch.connect("activate", this._onSwitch.bind(this));
                    this.menu.addMenuItem(this.item_switch, 0);
                }
                if (state === "active") {
                    this.item_switch.setToggleState(true);
                    this._api.start();
                } else {
                    this.item_switch.setToggleState(false);
                    this._api.stop();
                }
                break;
            default:
                throw `Unknown systemd state: ${state}`;
        }
        this.systemd_state = state;
        this._updateStatusIcon();
    },

    _onApiStateChanged(session, state) {
        switch (state) {
            case "connected":
                this.item_config.setSensitive(true);
                break;
            case "disconnected":
                this.item_config.setSensitive(false);
                break;
            default:
                throw `Unknown API connection state: ${state}`;
        }
        this.api_state = state;
        this._updateStatusIcon();
    },

    _updateStatusIcon() {
        if (this.api_state === "connected") {
            this._statusIcon.icon_name = "";
        } else if (this.systemd_state !== "inactive") {
            this._statusIcon.icon_name = "exclamation-triangle";
        } else {
            this._statusIcon.icon_name = "pause";
        }
    },

    destroy() {
        if (this._api)
            this._api.destroy();
        if (this._systemd)
            this._systemd.destroy();
        if (this._configFileWatcher)
            this._configFileWatcher.destroy();
        this.parent();
    },
});


function init(extension) {
    Convenience.initTranslations(GETTEXT_DOMAIN);
    let icon_theme = Gtk.IconTheme.get_default();
    icon_theme.prepend_search_path(`${extension.path}/icons`);
}


let _syncthing;

function enable() {
    _syncthing = new SyncthingMenu();
    Main.panel.addToStatusArea("syncthing", _syncthing);
}


function disable() {
    _syncthing.destroy();
}
