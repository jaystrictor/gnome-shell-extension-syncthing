const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Soup = imports.gi.Soup;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;


const _httpSession = new Soup.Session();


const FolderInfo = new Lang.Class({
    Name: 'FolderInfo',

    _init: function(config) {
        this.id = config.id;
        this.file = Gio.File.new_for_path(config.path);
        this.icon = this.getIcon();
    },

    getIcon: function() {
        try {
            let info = this.file.query_info('standard::symbolic-icon', 0, null);
	    return info.get_symbolic_icon();
        } catch(e if e instanceof Gio.IOErrorEnum) {
            // return a generic icon
            if (!this.file.is_native())
                return new Gio.ThemedIcon({ name: 'folder-remote-symbolic' });
            else
                return new Gio.ThemedIcon({ name: 'folder-symbolic' });
        }
    },
});

const FolderMenuItem = new Lang.Class({
    Name: 'FolderMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (info) {
        this.parent();

        this._icon = new St.Icon({ gicon: info.icon,
                                   style_class: 'popup-menu-icon' });
	this.actor.add_child(this._icon);

        this._label = new St.Label({ text: info.id });
        this.actor.add_child(this._label);
        this.actor.label_actor = this._label;

        this._uri = info.file.get_uri();
    },

    activate: function(event) {
	let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri(this._uri, launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch \"%s\"").format(this._uri), e.message);
        }

	this.parent(event);
    },
});


const SyncthingMenu = new Lang.Class({
    Name: 'SyncthingMenu',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, "Syncthing");

        let syncthingIcon = new St.Icon({ icon_name: 'syncthing-logo-symbolic',
                                          style_class: 'system-status-icon' });

        this.actor.add_child(syncthingIcon);

        this.item_switch = new PopupMenu.PopupSwitchMenuItem("Syncthing", false, null);
        this.item_switch.connect('activate', Lang.bind(this, this._onSwitch));
        this.menu.addMenuItem(this.item_switch);

        this.item_config = new PopupMenu.PopupImageMenuItem("Configuration", 'emblem-system-symbolic')
        this.item_config.connect('activate', Lang.bind(this, this._onConfig));
        this.menu.addMenuItem(this.item_config);
        this.item_config.setSensitive(false);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.folderMenu = new PopupMenu.PopupMenuSection()
        this.menu.addMenuItem(this.folderMenu);

        this._timeoutManager = new TimeoutManager(1, 60, Lang.bind(this, this.updateMenu));
    },

    _updateFolderList : function(config) {
        this.folderMenu.removeAll();
        // maybe it is better to destroy all children of this.folderMenu ?

        for (let i = 0; i < config.folders.length; i++) {
            let folderInfo = new FolderInfo(config.folders[i]);
            let item = new FolderMenuItem(folderInfo);
            this.folderMenu.addMenuItem(item);
        }
    },


    _soup_connected : function(session, msg) {
        if (msg.status_code !== 200) {
            return;
        }
        let data = msg.response_body.data;
        let config = JSON.parse(data);
        this._updateFolderList(config);
    },

    _onConfig : function(actor, event) {
        let launchContext = global.create_app_launch_context(event.get_time(), -1);
        try {
            Gio.AppInfo.launch_default_for_uri('http://localhost:8384', launchContext);
        } catch(e) {
            Main.notifyError(_("Failed to launch Syncthing configuration."), e.message);
        }
    },

    _onSwitch : function(actor, event) {
        if (actor.state) {
            let argv = '/usr/bin/systemctl --user start syncthing.service';
            GLib.spawn_sync(null, argv.split(' '), null, GLib.SpawnFlags.DEFAULT, null);
            this._timeoutManager.changeTimeout(1, 60);
        } else {
            let argv = '/usr/bin/systemctl --user stop syncthing.service';
            GLib.spawn_sync(null, argv.split(' '), null, GLib.SpawnFlags.DEFAULT, null);
            this._timeoutManager.changeTimeout(60, 60);
        }
        this.updateMenu();
    },

    getSyncthingState : function() {
        let argv = '/usr/bin/systemctl --user is-active syncthing.service';
        let result = GLib.spawn_sync(null, argv.split(' '), null, GLib.SpawnFlags.DEFAULT, null);
        return result[1].toString().trim();
    },

    updateMenu : function() {
        let state = this.getSyncthingState();
        if (state === 'active') {
            this.item_switch.setSensitive(true);
            this.item_switch.setToggleState(true);
            this.item_config.setSensitive(true);
            let msg = Soup.Message.new('GET', 'http://localhost:8384/rest/system/config');
            _httpSession.queue_message(msg, Lang.bind(this, this._soup_connected));
        } else if (state === 'inactive') {
            this.item_switch.setSensitive(true);
            this.item_switch.setToggleState(false);
            this.item_config.setSensitive(false);
        } else { // (state === 'unknown')
            this.item_switch.setSensitive(false);
            this.item_config.setSensitive(true);
            let msg = Soup.Message.new('GET', 'http://localhost:8384/rest/system/config');
            _httpSession.queue_message(msg, Lang.bind(this, this._soup_connected));
        }
    },

    destroy: function() {
        this._timeoutManager.cancel();
        this.parent();
    },
});


const TimeoutManager = new Lang.Class({
    Name: 'TimeoutManager',

    // The TimeoutManager starts with a timespan of start seconds,
    // after which the function func is called and the timout
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
            return true;
        }
        // exponential backoff
        this._current = this._current * 2;
        if (this._current > this.end) {
            this._current = this.end;
        }
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this._current, Lang.bind(this, this._callback));
        return false;
    },

    cancel: function() {
        GLib.Source.remove(this._source);
    },
});


function init(extension) {
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
