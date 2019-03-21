"use strict";

const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Lang = imports.lang;


function myLog(msg) {
    log(`[syncthingicon] ${msg}`);
}


var Control = GObject.registerClass({
    Signals: {
        "state-changed": {
            // "systemd-not-available", "unit-not-loaded", "active", or "inactive"
            param_types: [ GObject.TYPE_STRING ],
        },
    },
}, class Control extends GObject.Object {
    _init(end_interval) {
        super._init();
        this.state = "INIT";
        this._timeoutManager = new TimeoutManager(1, end_interval, Lang.bind(this, this.update));
    }

    startService() {
        let argv = "/bin/systemctl --user start syncthing.service";
        let [ok, pid] = GLib.spawn_async(null, argv.split(" "), null, GLib.SpawnFlags.SEARCH_PATH, null);
        GLib.spawn_close_pid(pid);
    }

    stopService() {
        let argv = "/bin/systemctl --user stop syncthing.service";
        let [ok, pid] = GLib.spawn_async(null, argv.split(" "), null, GLib.SpawnFlags.SEARCH_PATH, null);
        GLib.spawn_close_pid(pid);
    }

    _parseLoadState(data) {
        if (data.slice(0, 10) !== "LoadState=") {
            throw "Error parsing systemd LoadState.";
        }

        let loadState = data.slice(10);
        switch (loadState) {
            case "stub":
            case "loaded":
            case "not-found":
            case "bad-setting":
            case "error":
            case "merged":
            case "masked":
                return loadState
                break;
            default:
                throw `Error parsing systemd LoadState=${loadState}`;
        }
    }

    _parseActiveState(data) {
        if (data.slice(0, 12) !== "ActiveState=") {
            throw "Error parsing systemd ActiveState.";
        }

        let activeState = data.slice(12);
        switch (activeState) {
            case "active":
            case "reloading":
            case "inactive":
            case "failed":
            case "activating":
            case "deactivating":
                return activeState
                break;
            default:
                throw `Error parsing systemd ActiveState=${activeState}`;
        }

    }

    _parseData(bytes) {
        // Here we consolidate the different systemd LoadState and ActiveState states
        // into a single Control-state, which is one of
        // "systemd-not-available", "unit-not-loaded", "active", "inactive"
        let data = bytes2String(bytes);
        let lines = data.split("\n");
        if (lines.length !== 3 || lines[2] !== "") {
            throw "Error parsing systemd states.";
        }

        let loadState = this._parseLoadState(lines[0]);
        let activeState = this._parseActiveState(lines[1]);

        if (loadState !== "loaded") {
            return "unit-not-loaded";
        }
        if (activeState === "active") {
            return "active";
        } else {
            return "inactive";
        }
    }

    _onSystemdStateReceived(object, result) {
        try {
            let bytes = this._stream.read_bytes_finish(result);
            let newState = this._parseData(bytes);
            this._setState(newState);
        } catch(e) {
            myLog(e);
            this._setState("unit-not-loaded");
        }
    }

    _updateSystemdState() {
        if (this._childSource)
            return;
        let argv = "/bin/systemctl --user show -p LoadState -p ActiveState syncthing.service";
        let flags = Gio.SubprocessFlags.STDOUT_PIPE;
        try {
            let subprocess = Gio.Subprocess.new(argv.split(" "), flags);
            this._stream = subprocess.get_stdout_pipe();
            this._stream.read_bytes_async(60, GLib.PRIORITY_DEFAULT , null, Lang.bind(this, this._onSystemdStateReceived));
        } catch(e) {
            if (e.matches(GLib.spawn_error_quark(), GLib.SpawnError.NOENT)) {
                // Failed to execute child process “/bin/systemctl” (No such file or directory)
                this._setState("systemd-not-available");
            } else {
                myLog(e.message);
                this._setState("systemd-not-available");
            }
        }
        // Maybe we should wait here for the subprocess to finish with
        // this._subprocess.wait_async()
        // But on the other hand, the process should not be around for a long time.
    }

    _setState(newState) {
        if (newState !== this.state) {
            this.state = newState;
            this.emit("state-changed", this.state);
        }
    }

    update() {
        this._updateSystemdState();
    }

    setUpdateInterval(start, end) {
        this._timeoutManager.changeTimeout(start, end);
    }

    destroy() {
        this._timeoutManager.cancel();
    }
});


function bytes2String(bytes) {
    let result = "";
    let data = bytes.get_data();
    for (let i = 0; i < bytes.get_size(); i++) {
        result += String.fromCharCode(data[i]);
    }
    return result;
}


const TimeoutManager = class {
    // The TimeoutManager starts with a timespan of start seconds,
    // after which the function func is called and the timeout
    // is exponentially expanded to 2*start, 2*2*start, etc. seconds.
    // When the timeout overflows end seconds,
    // it is set to the final value of end seconds.
    constructor(start, end, func) {
        this._current = start;
        this.end = end;
        this.func = func;
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, start, Lang.bind(this, this._callback));
    }

    changeTimeout(start, end) {
        GLib.Source.remove(this._source);
        this._current = start;
        this.end = end;
        this._source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, start, Lang.bind(this, this._callback));
    }

    _callback() {
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
    }

    cancel() {
        GLib.Source.remove(this._source);
    }
}

