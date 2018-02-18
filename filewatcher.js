const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const config_filename = GLib.get_user_config_dir() + '/syncthing/config.xml';
const configfile = Gio.File.new_for_path(config_filename);

function getCurrentDir() {
    let stack = (new Error()).stack;
    let stackLine = stack.split('\n')[1];
    if (!stackLine)
        throw new Error("Could not find current file.");
    let match = new RegExp('@(.+):\\d+').exec(stackLine);
    if (!match)
        throw new Error("Could not find current file.");
    let path = match[1];
    let file = Gio.File.new_for_path(path);
    return file.get_parent();
}
imports.searchPath.unshift(getCurrentDir().get_path());
const Sax = imports.sax;

const ConfigParser = new Lang.Class({
    Name: 'ConfigParser',

    _init: function() {
        this.state = 'root';
        this.config = {};

        this._parser = Sax.sax.parser(true);
        this._parser.onerror = Lang.bind(this, this._onError);
        this._parser.onopentag = Lang.bind(this, this._onOpenTag);
        this._parser.onclosetag = Lang.bind(this, this._onCloseTag);
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
        // calculate the correct URI from variables 'tls' and 'address'
        this.config['uri'] = this._getURI(this.config);
        callback(this.config);
    },

    _getURI: function(config) {
        let address = config['address'];
        let tls = config['tls'];
        if (address) {
            if (tls)
                return "https://" + address;
            else
                return "http://" + address;
        }
        return null;
    },


    _onError: function(error) {
        log("Error parsing " + this.filename + ": " + error);
        this.config = null;
        // We should abort the parsing process here.
    },

    _onText: function(text) {
        if (this.state === 'address') {
            this.config['address'] = text;
        }
        if (this.state === 'apikey') {
            this.config['apikey'] = text;
        }
    },

    _onOpenTag: function(tag) {
        if (this.state === 'root' && tag.name === 'gui') {
            this.state = 'gui';
            this.config['tls'] = (tag.attributes['tls'].toUpperCase() == "TRUE");
        }
        if (this.state === 'gui') {
            if (tag.name === 'address')
                this.state = 'address';
            else if (tag.name === 'apikey')
                this.state = 'apikey';
        }
    },

    _onCloseTag: function(name) {
        if (this.state === 'gui' && name === 'gui') {
            this.state = 'end';
        }
        if (this.state === 'address' && name === 'address') {
            this.state = 'gui';
        }
        if (this.state === 'apikey' && name === 'apikey') {
            this.state = 'gui';
        }
    },
});


var ConfigFileWatcher = new Lang.Class({
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
        if (result != this.config) {
            this.config = result;
            this.callback(this.config);
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
