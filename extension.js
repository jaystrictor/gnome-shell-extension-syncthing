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


const _httpSession = new Soup.Session();

const GETTEXT_DOMAIN = 'gnome-shell-extension-syncthing';
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Settings = Convenience.getSettings();
const Filewatcher = Me.imports.filewatcher;

const FolderList = new Lang.Class({
    Name: 'FolderList',
    Extends: PopupMenu.PopupMenuSection,

    _init: function() {
        this.parent();
        this.folder_ids = [];
        this.folders = new Map();
        this.state = "idle";
    },

    update: function(baseURI, apikey, config) {
        let folder_ids_clone = this.folder_ids.slice();
        for (let i = 0; i < config.folders.length; i++) {
            let folder_config = config.folders[i];
            let id = folder_config.id;
            if (this.folder_ids.indexOf(id) !== -1) {
                // 'id' is already in this.folders_ids, just update.
                let position = folder_ids_clone.indexOf(id);
                folder_ids_clone.splice(position, 1);
            } else {
                // Add 'id' to folder list.
                this._addFolder(id, folder_config);
            }
            this.folders.get(id).update(baseURI, apikey, folder_config);
        }
        for (let j = 0; j < folder_ids_clone.length; j++) {
            let id = folder_ids_clone[j];
            // Remove 'id' from folder list.
            this._removeFolder(id);
        }
    },

    _addFolder: function(id, folder_config) {
        let position = this._sortedIndex(id);
        this.folder_ids.splice(position, 0, id);
        let menuitem = new FolderMenuItem(folder_config);
        this.addMenuItem(menuitem, position);
        this.folders.set(id, menuitem);
        menuitem.connect('status-changed', Lang.bind(this, this._folderChanged));
    },

    _removeFolder: function(id) {
        let position = this.folder_ids.indexOf(id);
        this.folder_ids.splice(position, 1);
        this.folders.get(id).destroy();
        this.folders.delete(id);
    },

    /* http://stackoverflow.com/a/21822316/3472468 */
    _sortedIndex: function (value) {
        let low = 0,
            high = this.folder_ids.length;

        while (low < high) {
            let mid = (low + high) >>> 1;
            if (this.folder_ids[mid] < value) low = mid + 1;
            else high = mid;
        }
        return low;
    },

    _folderChanged: function() {
        let states = this.folder_ids.map(Lang.bind(this, function(id){
            return this.folders.get(id).state;
        }));
        let state;
        if (states.indexOf("error") !== -1)
            state = "error";
        else if (states.indexOf("unknown") !== -1)
            state = "unknown";
        else if (states.indexOf("syncing") !== -1)
            state = "syncing";
        else
            state = "idle";
        if (state == this.state)
            return;
        this.state = state;
        this.emit('status-changed');
    },

    clearState: function() {
        for (let i = 0; i < this.folder_ids.length; i++) {
            let folder = this.folders.get(this.folder_ids[i]);
            folder.setState("unknown", null);
        }
    },
});

const FolderMenuItem = new Lang.Class({
    Name: 'FolderMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (info) {
        this.parent();
        this.info = info;
        this._icon = new St.Icon({ gicon: this._getIcon(),
                                   style_class: 'popup-menu-icon' });
        this.actor.add_child(this._icon);

        this._label = new St.Label({ text: info.id });
        this.actor.add_child(this._label);
        this.actor.label_actor = this._label;

        this._label_state = new St.Label({ style_class: 'folder-progress-text',
                                           x_expand: true,
                                           x_align: Clutter.ActorAlign.END,
                                           y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this._label_state);
        this._statusIcon = new St.Icon({ style_class: 'folder-status-icon' });
        this.actor.add_child(this._statusIcon);

        this._file = Gio.File.new_for_path(info.path);
    },

    _getIcon: function() {
        let file = Gio.File.new_for_path(this.info.path);
        try {
            let query_info = file.query_info('standard::symbolic-icon', 0, null);
            return query_info.get_symbolic_icon();
        } catch(e if e instanceof Gio.IOErrorEnum) {
            // return a generic icon
            if (!file.is_native())
                return new Gio.ThemedIcon({ name: 'folder-remote-symbolic' });
            else
                return new Gio.ThemedIcon({ name: 'folder-symbolic' });
        }
    },

    activate: function(event) {
        let uri = this._file.get_uri();
        let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri(uri, launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch URI \"%s\"").format(uri), e.message);
        }

        this.parent(event);
    },

    update: function(baseURI, apikey, folderConfig) {
        let label = (folderConfig.label !== "" ? folderConfig.label : folderConfig.id);
        this._label.text = label;
        if (this._soup_msg)
            _httpSession.cancel_message(this._soup_msg, Soup.Status.CANCELLED);
        let query_uri = baseURI + '/rest/db/status?folder=' + this.info.id;
        this._soup_msg = Soup.Message.new('GET', query_uri);
        if (apikey) {
            this._soup_msg.request_headers.append('X-API-Key', apikey);
        }
        _httpSession.queue_message(this._soup_msg, Lang.bind(this, this._folderReceived));
    },

    setState: function(state, model) {
        if (state === "idle") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = '';
        } else if (state === "scanning") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = 'database';
        } else if (state === "syncing") {
            let pct = this._syncPercentage(model);
            this._label_state.set_text("%d\u2009%%".format(pct));
            this._statusIcon.icon_name = 'exchange';
        } else if (state === "error") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = 'exclamation-triangle';
        } else if (state === "unknown") {
            this._label_state.set_text("");
            this._statusIcon.icon_name = 'question';
        } else {
            log("unknown syncthing state: " + state);
            this._label_state.set_text("");
            this._statusIcon.icon_name = 'question';
        }
        if (this.state !== state) {
            this.state = state;
            this.emit('status-changed');
        }
    },

    _folderReceived: function(session, msg) {
        this._soup_msg = null;
        if (msg.status_code === Soup.Status.CANCELLED) {
            // We cancelled the message.
            return;
        } else if (msg.status_code !== 200) {
            log("Failed to obtain syncthing folder information for folder id '" + this.info.id + "'.");
            this.setState("unknown", null);
            return;
        }
        let data = msg.response_body.data;
        let model = JSON.parse(data);
        let state = model.state;
        this.setState(state, model);
    },

    _syncPercentage: function(model) {
        if (model.globalBytes === 0)
            return 100;
        return Math.floor(100 * model.inSyncBytes / model.globalBytes);
    },

    destroy: function() {
        if (this._soup_msg)
            _httpSession.cancel_message(this._soup_msg, Soup.Status.CANCELLED);
        this.state = "DESTROY";
        this.emit('status-changed');
        this.parent();
    },
});


const SyncthingMenu = new Lang.Class({
    Name: 'SyncthingMenu',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, "Syncthing", false);

        let box = new St.BoxLayout();
        this.actor.add_child(box);

        this._syncthingIcon = new St.Icon({ icon_name: 'syncthing-logo-symbolic',
                                          style_class: 'system-status-icon syncthing-logo-icon' });
        box.add_child(this._syncthingIcon);

        this._statusIcon = new St.Icon({ style_class: 'system-status-icon syncthing-status-icon' });
        box.add_child(this._statusIcon);

        this.status_label = new St.Label({ style: 'font-size: 70%;',
                                         y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.status_label);

        this.item_switch_daemon = new PopupMenu.PopupSwitchMenuItem("Syncthing", false, null);
        this.item_switch_daemon.connect('activate', Lang.bind(this, this._onSwitchDaemon));
        this.menu.addMenuItem(this.item_switch_daemon);

        this.item_switch_inotify = new PopupMenu.PopupSwitchMenuItem("Syncthing INotify", false, null);
        this.item_switch_inotify.connect('activate', Lang.bind(this, this._onSwitchINotify));
        this.menu.addMenuItem(this.item_switch_inotify);

        this.item_config = new PopupMenu.PopupImageMenuItem(_("Web Interface"), 'emblem-system-symbolic')
        this.item_config.connect('activate', Lang.bind(this, this._onConfig));
        this.menu.addMenuItem(this.item_config);
        this.item_config.setSensitive(false);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.folder_list = new FolderList();
        this.menu.addMenuItem(this.folder_list);
        this.folder_list.connect('status-changed', Lang.bind(this, this._onStatusChanged));

        Settings.connect('changed', Lang.bind(this, this._onSettingsChanged));
        this._onSettingsChanged();

        this._isConnected = false;
        this._updateMenu();
        this._timeoutManager = new TimeoutManager(1, 10, Lang.bind(this, this._updateMenu));
    },

    _onSettingsChanged: function(settings, key) {
        if (Settings.get_boolean('autoconfig')) {
            if (! this._configFileWatcher) {
                this._onAutoConfigChanged(null);
                this._configFileWatcher = new Filewatcher.ConfigFileWatcher(Lang.bind(this, this._onAutoConfigChanged));
            }
        } else {
            if (this._configFileWatcher) {
                this._configFileWatcher.destroy();
                this._configFileWatcher = null;
            }
            this.baseURI = Settings.get_string('configuration-uri');
            this.apikey = Settings.get_string('api-key');
        }
    },

    _onAutoConfigChanged: function(config) {
        if (config === null) {
            this.baseURI = Settings.get_default_value('configuration-uri').unpack();
            this.apikey = null;
        } else {
            this.baseURI = config['uri'] || Settings.get_default_value('configuration-uri').unpack();
            this.apikey = config['apikey'];
        }
    },

    _configReceived: function(session, msg, baseURI, apikey) {
        if (msg.status_code !== 200) {
            // Check whether the syncthing daemon does not respond due to startup stage.
            if (msg.status_code !== Soup.Status.CANT_CONNECT) {
                log("Failed to connect to syncthing daemon at URI '" + baseURI + "': " + msg.status_code + " " + msg.reason_phrase);
                //log("Response body: " + msg.response_body.data);
            }
            // Clear the state of each folder.
            this.folder_list.clearState();
            if (this._isConnected) {
                this._isConnected = false;
                this._onStatusChanged();
            }
            // Do not update the folders of the folder list.
            return;
        }
        let data = msg.response_body.data;
        let config = JSON.parse(data);
        if (config !== null && 'version' in config && 'folders' in config && 'devices' in config)
            // This seems to be a valid syncthing connection.
            this.folder_list.update(baseURI, apikey, config);
            if (!this._isConnected) {
                this._isConnected = true;
                this._onStatusChanged();
            }
    },

    _onConfig: function(actor, event) {
        if (this.baseURI.startsWith('http://')) {
            this._openWebView();
        } else {
            let launchContext = global.create_app_launch_context(event.get_time(), -1);
            try {
                Gio.AppInfo.launch_default_for_uri(this.baseURI, launchContext);
            } catch(e) {
                Main.notifyError(_("Failed to launch URI \"%s\"").format(uri), e.message);
            }
        }
    },

    _openWebView: function() {
        let working_dir = Me.dir.get_path();
        let [ok, pid] = GLib.spawn_async(working_dir, ['gjs', 'webviewer.js'], null, GLib.SpawnFlags.SEARCH_PATH, null);
        GLib.spawn_close_pid(pid);
    },

    _onSwitchDaemon: function(actor, event) {
        if (actor.state) {
            let argv = 'systemctl --user start syncthing.service';
            let [ok, pid] = GLib.spawn_async(null, argv.split(' '), null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.spawn_close_pid(pid);
            this._timeoutManager.changeTimeout(1, 10);
        } else {
            let argv = 'systemctl --user stop syncthing.service';
            let [ok, pid] = GLib.spawn_async(null, argv.split(' '), null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.spawn_close_pid(pid);
            this._timeoutManager.changeTimeout(10, 10);
            // To prevent icon flickering we set _daemonRunning=false prematurely.
            // Even if this proves to be wrong in the following _updateMenu(), we don't do any harm.
            this._daemonRunning = false;
        }
        this._updateMenu();
    },

    _onSwitchINotify: function(actor, event) {
        if (actor.state) {
            let argv = 'systemctl --user start syncthing-inotify.service';
            let [ok, pid] = GLib.spawn_async(null, argv.split(' '), null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.spawn_close_pid(pid);
            this._timeoutManager.changeTimeout(1, 10);
        } else {
            let argv = 'systemctl --user stop syncthing-inotify.service';
            let [ok, pid] = GLib.spawn_async(null, argv.split(' '), null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.spawn_close_pid(pid);
            this._timeoutManager.changeTimeout(10, 10);
            // To prevent icon flickering we set _inotifyRunning=false prematurely.
            // Even if this proves to be wrong in the following _updateMenu(), we don't do any harm.
            this._inotifyRunning = false;
        }
        this._updateMenu();
    },

    _getSyncthingDaemonState: function() {
        if (this._childDaemonSource)
            return;
        let argv = 'systemctl --user is-active syncthing.service';
        let flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL;
        let [ok, pid, in_fd, out_fd, err_fd]  = GLib.spawn_async(null, argv.split(' '), null, flags, null);
        this._childDaemonSource = GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, Lang.bind(this, this._onSyncthingDaemonState));
    },

    _getSyncthingINotifyState: function() {
        if (this._childINotifySource)
            return;
        let argv = 'systemctl --user is-active syncthing-inotify.service';
        let flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL;
        let [ok, pid, in_fd, out_fd, err_fd]  = GLib.spawn_async(null, argv.split(' '), null, flags, null);
        this._childINotifySource = GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, Lang.bind(this, this._onSyncthingINotifyState));
    },

    _onSyncthingDaemonState: function(pid, status) {
        GLib.Source.remove(this._childDaemonSource);
        this._childDaemonSource = null;
        GLib.spawn_close_pid(pid);
        this._daemonRunning = (status === 0);
        this._onStatusChanged();
    },

    _onSyncthingINotifyState: function(pid, status) {
        GLib.Source.remove(this._childINotifySource);
        this._childINotifySource = null;
        GLib.spawn_close_pid(pid);
        this._inotifyRunning = (status === 0);
        this._onStatusChanged();
    },

    _updateMenu: function() {
        this._getSyncthingDaemonState();
        this._getSyncthingINotifyState();
        // The current syncthing config is fetched from 'http://localhost:8384/rest/system/config' or similar
        let config_uri = this.baseURI + '/rest/system/config';
        let msg = Soup.Message.new('GET', config_uri);
        if (this.apikey) {
            msg.request_headers.append('X-API-Key', this.apikey);
        }
        _httpSession.queue_message(msg, Lang.bind(this, this._configReceived, this.baseURI, this.apikey));
    },

    _onStatusChanged: function() {
        // This function is called whenever
        // 1) the status of the folder_list changes or
        // 2) the systemd 'is-active' status changes (variable 'this._daemonRunning') or
        // 3) the connection to the daemon (variable 'this._isConnected') changes.
        if (this._daemonRunning) {
            //this._syncthingIcon.icon_name = 'syncthing-logo-symbolic';
            this.item_switch_daemon.setToggleState(true);
            this.item_config.setSensitive(true);
            let state = this.folder_list.state;
            if (state === 'error' || ! this._isConnected) {
                this._statusIcon.icon_name = 'exclamation-triangle';
            } else if (state === 'unknown')
                this._statusIcon.icon_name = 'question';
            else if (state === 'syncing')
                this._statusIcon.icon_name = 'exchange';
            else
                this._statusIcon.icon_name = '';
        } else {
            this.item_switch_daemon.setToggleState(false);
            this.item_config.setSensitive(false);
            this._statusIcon.icon_name = 'pause';
        }

        this.item_switch_inotify.setToggleState(this._inotifyRunning);
    },

    destroy: function() {
        this._timeoutManager.cancel();
        if (this._childSource)
            GLib.Source.remove(this._childSource);
        if (this._configFileWatcher)
            this._configFileWatcher.destroy();
        this.parent();
    },
});


const TimeoutManager = new Lang.Class({
    Name: 'TimeoutManager',

    // The TimeoutManager starts with a timespan of start seconds,
    // after which the function func is called and the timeout
    // is exponentially expanded to 2*start, 2*2*start, etc. seconds.
    // When the timeout overflows end seconds,
    // it is set to the final value of end seconds.
    _init: function(start, end, func) {
        this._current = start;
        this.end = end;
        this.func = func;
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, start, Lang.bind(this, this._callback));
    },

    changeTimeout: function(start, end) {
        GLib.Source.remove(this._source);
        this._current = start;
        this.end = end;
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, start, Lang.bind(this, this._callback));
    },

    _callback: function() {
        this.func();

        if (this._current === this.end) {
            return GLib.SOURCE_CONTINUE;
        }
        // exponential backoff
        this._current = this._current * 2;
        if (this._current > this.end) {
            this._current = this.end;
        }
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this._current, Lang.bind(this, this._callback));
        return GLib.SOURCE_REMOVE;
    },

    cancel: function() {
        GLib.Source.remove(this._source);
    },
});


function init(extension) {
    Convenience.initTranslations(GETTEXT_DOMAIN);
    let icon_theme = imports.gi.Gtk.IconTheme.get_default();
    icon_theme.append_search_path(extension.path + '/icons');
}


let _syncthing;

function enable() {
    _syncthing = new SyncthingMenu();
    Main.panel.addToStatusArea('syncthing', _syncthing);
}


function disable() {
    _syncthing.destroy();
}
