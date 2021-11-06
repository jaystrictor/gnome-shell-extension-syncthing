"use strict";

const Config = imports.misc.config;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const GObject = imports.gi.GObject;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;


const GETTEXT_DOMAIN = "gnome-shell-extension-syncthing";
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Filewatcher = Me.imports.filewatcher;
const Folders = Me.imports.folders;
const SyncthingApi = Me.imports.syncthing_api;
const Systemd = Me.imports.systemd;

function myLog(msg) {
    log(`[syncthingicon] ${msg}`);
}

function getStatusIcon(iconName) {
    let path = Me.dir.get_path() + "/icons/hicolor/scalable/status/" + iconName + ".svg";
    let gicon = Gio.icon_new_for_string(path);
    return gicon;
}

function getSyncthingIcon(iconName) {
    let path = Me.dir.get_path() + "/icons/hicolor/symbolic/apps/syncthing-symbolic.svg";
    let gicon = Gio.icon_new_for_string(path);
    return gicon;
}


const SyncthingMenu = new GObject.registerClass(
    class SyncthingMenu extends PanelMenu.Button {
        _init() {
            super._init(0.0, "Syncthing", false);

            this._api = new SyncthingApi.SyncthingSession();
            this._settings = ExtensionUtils.getSettings();
            this._systemd = new Systemd.Control(64);

            this._initButton();
            this._initMenu();

            this.api_state = "disconnected";
            this._api.connect("connection-state-changed", this._onApiStateChanged.bind(this));

            this.systemd_state = "systemd-not-available";
            this._systemd.connect("state-changed", this._onSystemdStateChanged.bind(this));
            this._systemd.update();

            this.menu.connect("open-state-changed", this._menuOpenStateChanged.bind(this));

            this._settingsChangedId = this._settings.connect("changed", this._onSettingsChanged.bind(this));
            this._onSettingsChanged();
        }

        _initButton() {
            let box = new St.BoxLayout();
            this.add_actor(box);

            this._syncthingIcon = new St.Icon({ gicon: getSyncthingIcon(),
                style_class: "system-status-icon" });
            box.add_child(this._syncthingIcon);

            this._statusIcon = new St.Icon({ style_class: "system-status-icon syncthing-status-icon" });
            box.add_child(this._statusIcon);

            this.status_label = new St.Label({ style: "font-size: 70%;",
                y_align: Clutter.ActorAlign.CENTER });
            box.add_child(this.status_label);
        }

        _initMenu() {
            // 1. Syncthing On/Off Switch
            this.item_switch = null;

            // 2. Web Interface Button
            let icon = new Gio.ThemedIcon({ name: "emblem-system-symbolic" });

            this.item_config = new PopupMenu.PopupImageMenuItem(_("Web Interface"), icon);
            this.item_config.connect("activate", this._onConfig.bind(this));
            this.menu.addMenuItem(this.item_config);
            this.item_config.setSensitive(false);

            // 3. Separator
            this.separator = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.addMenuItem(this.separator);

            // 4. Folder List
            this.folder_list = new Folders.FolderList(this, this._api);
            this.menu.addMenuItem(this.folder_list);
        }

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
        }

        _onSettingsChanged(settings, key) {
            this.externalBrowser = this._settings.get_boolean("external-browser");

            if (this._settings.get_boolean("autoconfig")) {
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
                this.baseURI = this._settings.get_string("configuration-uri");
                this.apikey = this._settings.get_string("api-key");
            }

            this._api.setParams(this.baseURI, this.apikey);
        }

        _onAutoConfigChanged(config) {
            if (config === null) {
                this.baseURI = this._settings.get_default_value("configuration-uri").unpack();
                this.apikey = this._settings.get_default_value("api-key").unpack();
            } else {
                this.baseURI = config["uri"] || this._settings.get_default_value("configuration-uri").unpack();
                this.apikey = config["apikey"];
            }

            this._api.setParams(this.baseURI, this.apikey);
        }

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
        }

        _openWebView() {
            let working_dir = Me.dir.get_path();
            let [ok, pid] = GLib.spawn_async(working_dir, ["gjs", "webviewer.js"], null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.spawn_close_pid(pid);
        }

        _onSwitch(actor, event) {
            if (actor.state) {
                this._systemd.startService();
                this._systemd.setUpdateInterval(1, 8);
            } else {
                this._systemd.stopService();
                this._systemd.setUpdateInterval(1, 64);
            }
            this._systemd.update();
        }

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
        }

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
        }

        _updateStatusIcon() {
            if (this.api_state === "connected") {
                this._statusIcon.visible = false;
                this._statusIcon.gicon = null;
            } else {
                this._statusIcon.visible = true;
                if (this.systemd_state !== "inactive") {
                    this._statusIcon.gicon = getStatusIcon("exclamation-triangle");
                } else {
                    this._statusIcon.gicon = getStatusIcon("pause");
                }
            }
        }

        notifyListChanged() {
            this.menu._updateSeparatorVisibility(this.separator);
        }

        destroy() {
            this._settings.disconnect(this._settingsChangedId);
            if (this._api)
                this._api.destroy();
            if (this._systemd)
                this._systemd.destroy();
            if (this._configFileWatcher)
                this._configFileWatcher.destroy();
            super.destroy();
        }
    }
);


function init(extension) {
    ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
}


let _syncthing;

function enable() {
    _syncthing = new SyncthingMenu();
    Main.panel.addToStatusArea("syncthing", _syncthing);
}


function disable() {
    _syncthing.destroy();
    _syncthing = null;
}
