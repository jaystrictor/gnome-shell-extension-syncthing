"use strict";

const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Soup = imports.gi.Soup;

function myLog(msg) {
    log("[syncthingicon] " + msg);
}

var Folder = new Lang.Class({
    Name: "Folder",
    Extends: GObject.Object,
    Signals: {
        "state-changed": {
            param_types: [ GObject.TYPE_STRING ],
        },
        "label-changed": {
            param_types: [ GObject.TYPE_STRING ],
        },
        "path-changed": {
            param_types: [ GObject.TYPE_STRING ],
        },
    },


    _init: function(apiSession, folderConfig) {
        this.parent();
        this._soup_msg = null;
        this.state = null;
        this.label = null;
        this.path = null;
        this._apiSession = apiSession;
        this.id = folderConfig.id;
        this._setFolderConfig(folderConfig);
    },

    _folderReceived: function(session, msg) {
        this._soup_msg = null;
        if (msg.status_code === Soup.Status.CANCELLED) {
            // We cancelled the message. Do nothing.
            return;
        } else if (msg.status_code !== Soup.Status.OK) {
            myLog("Failed to obtain folder information for id \"" + this.id + "\".");
            this._setFolderConfig(null);
            this.state = "unknown";
            this.emit("state-changed", this.state);
            return;
        }
        let data = msg.response_body.data;
        this._parseFolderData(data);
    },

    _parseFolderData: function(data) {
        let model = JSON.parse(data);
        //log(JSON.stringify(model, null, 2));
        let state = model.state;

        switch (state) {
        // folder states are defined in https://github.com/syncthing/syncthing/blob/master/lib/model/folderstate.go
            case "idle":
            case "scanning":
            case "syncing":
            case "error":
            case "unknown":
                break;
            default:
                myLog("Unknown syncthing folder state: " + state);
                this.state = "unknown";
        }
        if (this.state !== state) {
            this.state = state;
            this.emit("state-changed", this.state);
        }
    },

    _setFolderConfig: function(folderConfig) {
        let label = this.id;
        let path = null;
        if (folderConfig) {
            if (folderConfig.label) {
                label = folderConfig.label;
            }
            if (folderConfig.path) {
                path = folderConfig.path;
            }
        }
        if (this.label !== label) {
            this.label = label;
            this.emit("label-changed", this.label);
        }
        if (this.path !== path) {
            this.path = path;
            this.emit("path-changed", this.path);
        }
    },

    statusRequest: function(uri, apikey) {
        let soupSession = this._apiSession.soupSession;
        if (this._soup_msg)
            soupSession.cancel_message(this._soup_msg, Soup.Status.CANCELLED);
        // This is an expensive call, increasing CPU and RAM usage on the device. Use sparingly.
        let query_uri = uri + "/rest/db/status?folder=" + this.id;
        this._soup_msg = Soup.Message.new("GET", query_uri);
        if (apikey) {
            this._soup_msg.request_headers.append("X-API-Key", apikey);
        }
        soupSession.queue_message(this._soup_msg, Lang.bind(this, this._folderReceived));
    },

    cancelUpdate: function() {
        if (this._soup_msg) {
            let soupSession = this._apiSession.soupSession;
            soupSession.cancel_message(this._soup_msg, Soup.Status.CANCELLED);
        }
    },
});


var SyncthingSession = new Lang.Class({
    Name: "SyncthingSession",
    Extends: GObject.Object,
    Signals: {
        "connection-state-changed": {
            param_types: [ GObject.TYPE_STRING ],
        },
        "updown-state-changed": {
            param_types: [ GObject.TYPE_STRING ],
        },
        "folder-added": {
            param_types: [ GObject.TYPE_OBJECT ],
        },
        "folder-removed": {
            param_types: [ GObject.TYPE_OBJECT ],
        },
    },

    _init: function() {
        this.parent();
        this.soupSession = new Soup.Session();
        // this.folders is a Map:
        // id -> folder
        this.folders = new Map();
        this.state = null;

        this._timeoutManager = new TimeoutManager(1, 64, Lang.bind(this, this.update));
    },

    _statusNotOk: function(msg, uri) {
        myLog("Failed to connect to syncthing daemon at URI \"" + uri + "\": " + msg.reason_phrase);
        if (msg.status_code === Soup.Status.SSL_FAILED) {
            myLog("TLS is currently not supported.");
        } else if (msg.response_body.data === "CSRF Error\n") {
            myLog("CSRF Error. Please verify your API key.");
        } else if (msg.response_body.data !== null) {
            myLog("Response body: " + msg.response_body.data);
        }
        this._setConnectionState("disconnected");
    },

    _configReceived: function(session, msg, uri, apikey) {
        if (msg.status_code !== Soup.Status.OK) {
            this._statusNotOk(msg, uri);
            for (let folder of this.folders.values()) {
                this.emit("folder-removed", folder);
            }
            this.folders = new Map();
            return;
        }
        let data = msg.response_body.data;
        try {
            this._parseConfig(uri, apikey, data);
        } catch(e) {
            myLog(e);
            for (let folder of this.folders.values()) {
                this.emit("folder-removed", folder);
            }
            this.folders = new Map();
            return;
        }
        this.connectionsRequest(uri);
    },

    _parseConfig: function(uri, apikey, data) {
        let config = JSON.parse(data);
        if (config === null || ! "version" in config || ! "folders" in config || ! "devices" in config) {
            throw("Connection to syncthing daemon responded with unparseable data.");
        }
        //log(JSON.stringify(config, null, 2));
        this._setConnectionState("connected");

        let folders_remaining = new Set(this.folders.values());

        for (let i = 0; i < config.folders.length; i++) {
            let folderConfig = config.folders[i];
            let id = folderConfig.id;
            let folder = this.folders.get(id);
            if (folder) {
                // a folder with this id already exists
                folder._setFolderConfig(folderConfig);
            } else {
                // we create a new folder with this id
                folder = new Folder(this, folderConfig);
                this.folders.set(id, folder);
                this.emit("folder-added", folder);
            }
            folders_remaining.delete(folder);
            folder.statusRequest(uri, apikey);
        }

        for (let [id, folder] of folders_remaining.entries()) {
            this.folders.delete(id);
            this.emit("folder-removed", folder);
        }
    },

    configRequest: function(uri, apikey) {
        // The current syncthing config is fetched from
        // "http://localhost:8384/rest/system/config" or similar.
        let config_uri = uri + "/rest/system/config";
        let msg = Soup.Message.new("GET", config_uri);
        if (apikey) {
            msg.request_headers.append("X-API-Key", apikey);
        }
        this.soupSession.queue_message(msg, Lang.bind(this, this._configReceived, uri, apikey));
    },

    _parseConnections: function(data) {
        let conns = JSON.parse(data);
        if (conns === null || ! "connections" in conns || ! "total" in conns) {
            throw("Connection to syncthing daemon responded with unparseable data.");
        }
        //log(JSON.stringify(conns, null, 2));
        let total = conns.total;
        if (total === null || ! "at" in total || ! "inBytesTotal" in total || ! "outBytesTotal" in total) {
            throw("Connection to syncthing daemon responded with unparseable data.");
        }
        let currentTotal = {
            "inBytesTotal":  total.inBytesTotal,
            "outBytesTotal":  total.outBytesTotal,
            "date": new Date(total.at),
        };

        if (! this.lastTotal) {
            this.lastTotal = currentTotal;
            this._setUpDownState("none");
            return;
        }

        let date = new Date(total.at);

        let milliseconds = date - this.lastTotal.date;
        let inDiff = total.inBytesTotal - this.lastTotal.inBytesTotal;
        let outDiff = total.outBytesTotal - this.lastTotal.outBytesTotal;

        if (milliseconds <= 0 || inDiff < 0 || outDiff < 0) {
            myLog("API connections in the future. Will try again later.");
            this.lastTotal = currentTotal;
            this._setUpDownState("none");
            return;
        }
        if (milliseconds > (64+5) * 1000) {
            myLog("API connections date too old. Will try again later.");
            this.lastTotal = currentTotal;
            this._setUpDownState("none");
            return;
        }

        let inRate = inDiff * 1000 / milliseconds;
        let outRate = outDiff * 1000 / milliseconds;
        let downloading = inRate > 10;
        let uploading = outRate > 10;
        if (downloading) {
            if (uploading) {
                this._setUpDownState("updown");
            } else {
                this._setUpDownState("down");
            }
        } else {
            if (uploading) {
                this._setUpDownState("up");
            } else {
                this._setUpDownState("none");
            }
        }
        this.lastTotal = currentTotal;
    },

    _setConnectionState: function(newState) {
        if (newState !== this.connectionState) {
            this.connectionState = newState;
            this.emit("connection-state-changed", newState);
        }
    },

    _setUpDownState: function(newState) {
        if (newState !== this.upDownState) {
            this.upDownState = newState;
            this.emit("updown-state-changed", newState);
        }
    },

    _connectionsReceived: function(session, msg, uri) {
        if (msg.status_code !== Soup.Status.OK) {
            this._statusNotOk(msg, uri);
            // Do nothing.
            return;
        }
        let data = msg.response_body.data;
        try {
            this._parseConnections(data);
        } catch(e) {
            myLog(e);
        }
    },

    connectionsRequest: function(uri) {
        let config_uri = uri + "/rest/system/connections";
        let msg = Soup.Message.new("GET", config_uri);
        if (this.apikey) {
            msg.request_headers.append("X-API-Key", this.apikey);
        }
        this.soupSession.queue_message(msg, Lang.bind(this, this._connectionsReceived, uri));
    },

    update: function() {
        if (this.uri) {
            this.configRequest(this.uri, this.apikey);
        }
    },

    setUpdateInterval: function(start, end) {
        this._timeoutManager.changeTimeout(start, end);
    },

    cancelAllUpdates: function() {
        if (this._connections_soup_msg)
            this.soupSession.cancel_message(this._connections_soup_msg, Soup.Status.CANCELLED);
        if (this._config_soup_msg)
            this.soupSession.cancel_message(this._config_soup_msg, Soup.Status.CANCELLED);
        for (let folder of this.folders.values()) {
            folder.cancelUpdate();
        }
    },

    setParams: function(uri, apikey) {
        this._setConnectionState("disconnected");
        this.lastTotal = null;
        this._setUpDownState("none");
        this.uri = uri;
        this.apikey = apikey;
        this.cancelAllUpdates();
        this.setUpdateInterval(1, 64);
    },

    destroy: function() {
        this.cancelAllUpdates();
        this._timeoutManager.cancel();
    },
});



const TimeoutManager = new Lang.Class({
    Name: "TimeoutManager",

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

