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
const config_filename = GLib.get_user_config_dir() + '/syncthing/config.xml';
const configfile = Gio.File.new_for_path(config_filename);

const GETTEXT_DOMAIN = 'gnome-shell-extension-syncthing';
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Settings = Convenience.getSettings();
const Sax = Me.imports.sax;


const ConfigParser = new Lang.Class({
    Name: 'ConfigParser',

    _init: function() {
        this.state = 'root';
        this.address = null;
        this.tls = false;

        this._parser = Sax.sax.parser(true);
        this._parser.onerror = Lang.bind(this, this._onError);
        this._parser.onopentag = Lang.bind(this, this._onOpenTag);
        this._parser.ontext = Lang.bind(this, this._onText);
    },

    run_sync: function(callback) {
        try {
            let success, data, tag;
            [success, data, tag] = configfile.load_contents(null);
            this._parser.write(data);
        } catch (e) {
            log("Failed to read " + config_filename + ": " + e.message);
        }
        callback(this._getResult());
    },

    _getResult: function() {
        if (this.address) {
            if (this.tls)
                return "https://" + this.address;
            else
                return "http://" + this.address;
        } else {
            return null;
        }
    },

    _onError: function(error) {
        log("Error parsing " + this.filename + ": " + error);
        this.address = null;
        // We should abort the parsing process here.
    },

    _onText: function(text) {
        if (this.state === 'address') {
            this.address = text;
            this.state = 'end';
        }
    },

    _onOpenTag: function(tag) {
        if (this.state === 'root' && tag.name === 'gui') {
            this.state = 'gui';
            if (tag.attributes['tls'].toUpperCase() == "TRUE")
                this.tls = true;
            return;
        }
        if (this.state === 'gui' && tag.name === 'address') {
            this.state = 'address';
        }
    },
});


const ConfigFileWatcher = new Lang.Class({
    Name: 'ConfigFileWatcher',

    /* File Watcher with 4 internal states:
       ready -> warmup -> running -> cooldown
         ^                              |
         --------------------------------
    */
    // Stop warmup after 1 second, cooldown after 10 seconds.
    WARMUP_TIME: 1,
    COOLDOWN_TIME: 10,

    _init: function(callback) {
        this.callback = callback;
        this.running_state = 'ready';
        this.run_scheduled = false;
        this.monitor = configfile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.monitor.connect('changed', Lang.bind(this, this._configfileChanged));
        this._configfileChanged();
    },

    _configfileChanged: function(monitor, file, other_file, event_type) {
        if (this.running_state === 'ready') {
            this.running_state = 'warmup';
            this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this.WARMUP_TIME, Lang.bind(this, this._nextState));
        } else if (this.running_state === 'warmup') {
            // Nothing to do here.
        } else if (this.running_state === 'running') {
            this.run_scheduled = true;
        } else if (this.running_state === 'cooldown') {
            this.run_scheduled = true;
        }
    },

    _run: function() {
        let configParser = new ConfigParser();
        configParser.run_sync(Lang.bind(this, this._onRunFinished));
    },

    _onRunFinished: function(result) {
        this.running_state = 'cooldown';
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this.COOLDOWN_TIME, Lang.bind(this, this._nextState));
        if (result != this.uri) {
            this.uri = result;
            this.callback(this.uri);
        }
    },

    _nextState: function() {
        this._source = null;
        if (this.running_state === 'warmup') {
            this.running_state = 'running';
            this.run_scheduled = false;
            this._run();
        } else {
            // this.running_state === 'cooldown'
            this.running_state = 'ready';
            if (this.run_scheduled) {
                this.running_state = 'warmup';
                this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, WARMUP_TIME, Lang.bind(this, this._nextState));
            }
        }
        return GLib.SOURCE_REMOVE;
    },

    destroy: function() {
        if (this._source)
            GLib.Source.remove(this._source);
    },
});


const FolderList = new Lang.Class({
    Name: 'FolderList',
    Extends: PopupMenu.PopupMenuSection,

    _init: function() {
        this.parent();
        this.folder_ids = [];
        this.folders = new Map();
        this.state = "idle";
    },

    update: function(baseURI, config) {
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
            this.folders.get(id).update(baseURI);
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


    _folderChanged: function(folder) {
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
            folder.setState("idle");
        }
    },
});

const FolderMenuItem = new Lang.Class({
    Name: 'FolderMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (info) {
        this._status = "";
        this.parent();
        this.info = info;
        this._icon = new St.Icon({ gicon: this._getIcon(),
                                   style_class: 'popup-menu-icon' });
        this.actor.add_child(this._icon);

        this._label = new St.Label({ text: info.id });
        this.actor.add_child(this._label);
        this.actor.label_actor = this._label;

        this._label_state = new St.Label({ style: 'color: gray; font-size: 80%;',
                                           x_expand: true,
                                           x_align: Clutter.ActorAlign.END,
                                           y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this._label_state);

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

    update: function(baseURI) {
        if (this._soup_msg)
            _httpSession.cancel_message(this._soup_msg, Soup.Status.CANCELLED);
        let query_uri = baseURI + '/rest/db/status?folder=' + this.info.id;
        this._soup_msg = Soup.Message.new('GET', query_uri);
        _httpSession.queue_message(this._soup_msg, Lang.bind(this, this._folderReceived));
    },

    setState: function(model) {
        let state = model.state;
        if (state === "idle") {
            this._label_state.set_text("");
        } else if (state === "scanning") {
            this._label_state.set_text("\u2026"); // …
            this._label_state.set_style('color: gray; font-size: 80%;');
        } else if (state === "syncing") {
            let pct = this._syncPercentage(model);
            this._label_state.set_text("%d\u2009%%".format(pct));
            this._label_state.set_style('color: gray; font-size: 80%;');
        } else if (state === "error") {
            this._label_state.set_text("\u2757"); // ❗
            this._label_state.set_style('color: red; font-size: 90%;');
        } else if (state === "unknown") {
            this._label_state.set_text("\u2753"); // ❓
            this._label_state.set_style('color: gray; font-size: 80%;');
        } else {
            log("unknown syncthing state: " + state);
            this._label_state.set_text("\u2753"); // ❓
            this._label_state.set_style('color: gray; font-size: 80%;');
        }
    },

    _folderReceived: function(session, msg) {
        this._soup_msg = null;
        if (msg.status_code === Soup.Status.CANCELLED) {
            // We cancelled the message.
            return;
        } else if (msg.status_code !== 200) {
            // Failed to connect.
            this.setState("unknown");
            return;
        }
        let data = msg.response_body.data;
        let model = JSON.parse(data);
        this.setState(model);
        let state = model.state;
        if (this.state !== state) {
            this.state = state;
            this.emit('status-changed');
        }
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
                                          style_class: 'system-status-icon' });
        box.add_child(this._syncthingIcon);

        this.status_label = new St.Label({ style: 'font-size: 70%;',
                                         y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.status_label);

        this.item_switch = new PopupMenu.PopupSwitchMenuItem("Syncthing", false, null);
        this.item_switch.connect('activate', Lang.bind(this, this._onSwitch));
        this.menu.addMenuItem(this.item_switch);

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

        this._updateMenu();
        this._timeoutManager = new TimeoutManager(1, 10, Lang.bind(this, this._updateMenu));
    },

    _onSettingsChanged: function(settings, key) {
        if (Settings.get_boolean('autoconfig')) {
            if (! this._configFileWatcher) {
                this.baseURI = Settings.get_default_value('configuration-uri').unpack();
                this._configFileWatcher = new ConfigFileWatcher(Lang.bind(this, this._onAutoURIChanged));
            }
        } else {
            if (this._configFileWatcher) {
                this._configFileWatcher.destroy();
                this._configFileWatcher = null;
            }
            this.baseURI = Settings.get_string('configuration-uri');
        }
    },

    _onAutoURIChanged: function(uri) {
        if (uri)
            this.baseURI = uri;
        else
            this.baseURI = Settings.get_default_value('configuration-uri').unpack();
    },

    _configReceived: function(session, msg, baseURI) {
        if (msg.status_code !== 200) {
            // Failed to connect.
            this.folder_list.clearState();
            // Do not update the folders of the folder list.
            return;
        }
        let data = msg.response_body.data;
        let config = JSON.parse(data);
        if ('version' in config && 'folders' in config && 'devices' in config)
            // This seems to be a valid syncthing connection.
            this.folder_list.update(baseURI, config);
    },

    _onConfig: function(actor, event) {
        let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri(this.baseURI, launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch URI \"%s\"").format(uri), e.message);
        }
    },

    _onSwitch: function(actor, event) {
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

    _getSyncthingState: function() {
        if (this._childSource)
            return;
        let argv = 'systemctl --user is-active syncthing.service';
        let flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL;
        let [ok, pid, in_fd, out_fd, err_fd]  = GLib.spawn_async(null, argv.split(' '), null, flags, null);
        this._childSource = GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, Lang.bind(this, this._onSyncthingState));
    },

    _onSyncthingState: function(pid, status) {
        GLib.Source.remove(this._childSource);
        this._childSource = null;
        GLib.spawn_close_pid(pid);
        this._daemonRunning = (status === 0);
        this._onStatusChanged(this.folder_list);
    },

    _updateMenu: function() {
        this._getSyncthingState();
        // The current syncthing config is fetched from 'http://localhost:8384/rest/system/config' or similar
        let config_uri = this.baseURI + '/rest/system/config';
        let msg = Soup.Message.new('GET', config_uri);
        _httpSession.queue_message(msg, Lang.bind(this, this._configReceived, this.baseURI));
    },

    _onStatusChanged: function(folder_list) {
        if (this._daemonRunning) {
            //this._syncthingIcon.icon_name = 'syncthing-logo-symbolic';
            this.item_switch.setToggleState(true);
            this.item_config.setSensitive(true);
            let state = folder_list.state;
            if (state === 'error')
                this.status_label.text = "\u2757"; // ❗
            else if (state === 'unknown')
                this.status_label.text = "\u2753"; // ❓
            else if (state === 'syncing')
                this.status_label.text = "🔄"; // \u{1f504}
            else
                this.status_label.text = "";
        } else {
            //this._syncthingIcon.icon_name = 'syncthing-off-symbolic';
            this.item_switch.setToggleState(false);
            this.item_config.setSensitive(false);
            this.status_label.text = "\u23f9"; // ⏹
        }
    },

    destroy: function() {
        this._timeoutManager.cancel();
        if (this._childSource)
            GLib.Source.remove(this._childSource);
        if (this._configwatcher)
            this._configwatcher.destroy();
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
