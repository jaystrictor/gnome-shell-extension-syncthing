const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Sax = Me.imports.sax;

const config_filename = GLib.get_user_config_dir() + '/syncthing/config.xml';
const configfile = Gio.File.new_for_path(config_filename);


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
