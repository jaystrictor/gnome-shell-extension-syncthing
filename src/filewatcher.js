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
        `${GLib.get_home_dir()}/.var/app/me.kozec.syncthingtk/config/syncthing`,
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

const ConfigParser = class {
    constructor(file) {
        this.file = file;
        this.state = "root";
        this.config = {};

        this._parser = new Saxes.SaxesParser( {position: true, fileName: file.get_basename()} );
        this._parser.onerror = this._onError.bind(this);
        this._parser.onopentag = this._onOpenTag.bind(this);
        this._parser.onclosetag = this._onCloseTag.bind(this);
        this._parser.ontext = this._onText.bind(this);
    }

    run_sync(callback) {
        try {
            let success, data, tag;
            [success, data, tag] = this.file.load_contents(null);
            if (data instanceof Uint8Array) {
                data = imports.byteArray.toString(data);
            }
            this._parser.write(data);
        } catch (e) {
            myLog(`Failed to read config file ${this.file.get_path()}: ${e.message}`);
            callback(null);
        }
        // calculate the correct URI from variables "tls" and "address"
        this.config["uri"] = this._getURI(this.config);
        callback(this.config);
    }

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
    }


    _onError(error) {
        throw(error);
    }

    _onText(text) {
        if (this.state === "address") {
            this.config["address"] = text;
        }
        if (this.state === "apikey") {
            this.config["apikey"] = text;
        }
    }

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
    }

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
    }
}

// Stop warmup after 1 second, cooldown after 10 seconds.
const WARMUP_TIME = 1;
const COOLDOWN_TIME = 10;

var ConfigFileWatcher = class {
    /* File Watcher with 4 internal states:
       ready -> warmup -> running -> cooldown
         ^                              |
         --------------------------------
    */

    constructor(callback, file) {
        this.callback = callback;
        this.file = file;
        this.running_state = "ready";
        this.run_scheduled = false;
        this.monitor = this.file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.monitor.connect("changed", this._configfileChanged.bind(this));
        this._configfileChanged();
    }

    _configfileChanged(monitor, file, other_file, event_type) {
        if (this.running_state === "ready") {
            this.running_state = "warmup";
            this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, WARMUP_TIME, this._nextState.bind(this));
        } else if (this.running_state === "warmup") {
            // Nothing to do here.
        } else if (this.running_state === "running") {
            this.run_scheduled = true;
        } else if (this.running_state === "cooldown") {
            this.run_scheduled = true;
        }
    }

    _run() {
        let configParser = new ConfigParser(this.file);
        configParser.run_sync(this._onRunFinished.bind(this));
    }

    _onRunFinished(result) {
        this.running_state = "cooldown";
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, COOLDOWN_TIME, this._nextState.bind(this));
        if (result != this.config) {
            this.config = result;
            this.callback(this.config);
        }
    }

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
                this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, WARMUP_TIME, this._nextState.bind(this));
            }
        }
        return GLib.SOURCE_REMOVE;
    }

    destroy() {
        if (this._source)
            GLib.Source.remove(this._source);
    }
}
