const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const Lang = imports.lang;

const GETTEXT_DOMAIN = 'gnome-shell-extension-syncthing';
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const SyncthingIconPrefsWidget = new GObject.Class({
    Name: 'SyncthingIcon.Prefs.Widget',
    GTypeName: 'SyncthingIconPrefsWidget',
    Extends: Gtk.Grid,

    _init : function(params) {
        this.parent(params);
        this.margin = 18;
        this.row_spacing = this.column_spacing = 12;
        this.orientation = Gtk.Orientation.HORIZONTAL;

        let presentLabel = '<b>' + _("Alternative Web Interface URI") + '</b>';
        this.add(new Gtk.Label({ label: presentLabel,
                                 use_markup: true,
                                 halign: Gtk.Align.END }));

        let entry = new Gtk.Entry({ hexpand: true,
                                    input_purpose: Gtk.InputPurpose.URL });
        this.add(entry);

        let reset_button = new Gtk.Button({ label: "Reset" });
        reset_button.connect('clicked', Lang.bind(this, this._onReset));
        this.add(reset_button);

        this._settings = Convenience.getSettings();
        this._settings.bind('configuration-uri', entry, 'text', Gio.SettingsBindFlags.DEFAULT);
    },

    _onReset : function() {
        this._settings.reset('configuration-uri');
    },
});

function init(metadata) {
    Convenience.initTranslations(GETTEXT_DOMAIN);
}

function buildPrefsWidget() {
    let widget = new SyncthingIconPrefsWidget();
    widget.show_all();

    return widget;
}
