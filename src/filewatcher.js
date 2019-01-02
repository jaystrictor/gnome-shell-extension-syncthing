"use strict";

const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

function getCurrentDir() {
    let stack = (new Error()).stack;
    let stackLine = stack.split("\n")[1];
    if (!stackLine)
        throw new Error("Could not find current file.");
    let match = new RegExp("@(.+):\\d+").exec(stackLine);
    if (!match)
        throw new Error("Could not find current file.");
    let path = match[1];
    let file = Gio.File.new_for_path(path);
    return file.get_parent();
}
imports.searchPath.unshift(getCurrentDir().get_path());
const Saxes = imports.saxes;

function myLog(msg) {
    log(`[syncthingicon] ${msg}`);
}

function probeDirectories() {
    const directories = [
        `${GLib.get_user_config_dir()}/syncthing`,
        `${GLib.get_home_dir()}/snap/syncthing/common/syncthing`,
    ];
    for (let dir of directories) {
        let configfile = Gio.File.new_for_path(`${dir}/config.xml`);
        let info = null;
        try {
            info = configfile.query_info(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE, null);
        } catch(e) {
            // file does not exist
        }
        if (info !== null) {
            myLog(`found syncthing config file in ${dir}`);
            return configfile;
        }
    }
    myLog(`syncthing config file not found in ${directories}`);
    return null;
}

const ConfigParser = new Lang.Class({
    Name: "ConfigParser",

    _init(file) {
        this.file = file;
        this.state = "root";
        this.config = {};

        this._parser = new Saxes.SaxesParser( {position: true} );
        this._parser.onerror = Lang.bind(this, this._onError);
        this._parser.onopentag = Lang.bind(this, this._onOpenTag);
        this._parser.onclosetag = Lang.bind(this, this._onCloseTag);
        this._parser.ontext = Lang.bind(this, this._onText);
    },

    run_sync(callback) {
        try {
            let success, data, tag;
            [success, data, tag] = this.file.load_contents(null);
            data = imports.byteArray.toString(data);
            this._parser.write(data);
        } catch (e) {
            myLog(`Failed to read config file ${this.file.get_path()}: ${e.message}`);
            callback(null);
        }
        // calculate the correct URI from variables "tls" and "address"
        this.config["uri"] = this._getURI(this.config);
        callback(this.config);
    },

    _getURI(config) {
        let address = config["address"];
        let tls = config["tls"];
        if (address) {
            if (tls)
                return `https://${address}`;
            else
                return `http://${address}`;
        }
        return null;
    },


    _onError(error) {
        throw(error);
    },

    _onText(text) {
        if (this.state === "address") {
            this.config["address"] = text;
        }
        if (this.state === "apikey") {
            this.config["apikey"] = text;
        }
    },

    _onOpenTag(tag) {
        if (this.state === "root" && tag.name === "gui") {
            this.state = "gui";
            this.config["tls"] = (tag.attributes["tls"].toUpperCase() == "TRUE");
        }
        if (this.state === "gui") {
            if (tag.name === "address")
                this.state = "address";
            else if (tag.name === "apikey")
                this.state = "apikey";
        }
    },

    _onCloseTag(tag) {
        if (this.state === "gui" && tag.name === "gui") {
            this.state = "end";
        }
        if (this.state === "address" && tag.name === "address") {
            this.state = "gui";
        }
        if (this.state === "apikey" && tag.name === "apikey") {
            this.state = "gui";
        }
    },
});


var ConfigFileWatcher = new Lang.Class({
    Name: "ConfigFileWatcher",

    /* File Watcher with 4 internal states:
       ready -> warmup -> running -> cooldown
         ^                              |
         --------------------------------
    */
    // Stop warmup after 1 second, cooldown after 10 seconds.
    WARMUP_TIME: 1,
    COOLDOWN_TIME: 10,

    _init(callback, file) {
        this.callback = callback;
        this.file = file;
        this.running_state = "ready";
        this.run_scheduled = false;
        this.monitor = this.file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.monitor.connect("changed", Lang.bind(this, this._configfileChanged));
        this._configfileChanged();
    },

    _configfileChanged(monitor, file, other_file, event_type) {
        if (this.running_state === "ready") {
            this.running_state = "warmup";
            this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this.WARMUP_TIME, Lang.bind(this, this._nextState));
        } else if (this.running_state === "warmup") {
            // Nothing to do here.
        } else if (this.running_state === "running") {
            this.run_scheduled = true;
        } else if (this.running_state === "cooldown") {
            this.run_scheduled = true;
        }
    },

    _run() {
        let configParser = new ConfigParser(this.file);
        configParser.run_sync(Lang.bind(this, this._onRunFinished));
    },

    _onRunFinished(result) {
        this.running_state = "cooldown";
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, this.COOLDOWN_TIME, Lang.bind(this, this._nextState));
        if (result != this.config) {
            this.config = result;
            this.callback(this.config);
        }
    },

    _nextState() {
        this._source = null;
        if (this.running_state === "warmup") {
            this.running_state = "running";
            this.run_scheduled = false;
            this._run();
        } else {
            // this.running_state === "cooldown"
            this.running_state = "ready";
            if (this.run_scheduled) {
                this.running_state = "warmup";
                this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, WARMUP_TIME, Lang.bind(this, this._nextState));
            }
        }
        return GLib.SOURCE_REMOVE;
    },

    destroy() {
        if (this._source)
            GLib.Source.remove(this._source);
    },
});
