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
        this._settings = Convenience.getSettings();

        this.margin = 18;
        this.row_spacing = this.column_spacing = 12;
        this.orientation = Gtk.Orientation.HORIZONTAL;

        let methodLabel = '<b>' + _("Automatic Configuration") + '</b>';
        this.attach(new Gtk.Label({ label: methodLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 0, 1, 1);

        let autoSwitch = new Gtk.Switch({ halign: Gtk.Align.START,
                                            valign: Gtk.Align.BASELINE });
        this.attach(autoSwitch, 1, 0, 2, 1);
        this._settings.bind('autoconfig', autoSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        let presentLabel = '<b>' + _("Alternative Web Interface URI") + '</b>';
        this.attach(new Gtk.Label({ label: presentLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 1, 1, 1);

        let entry = new Gtk.Entry({ input_purpose: Gtk.InputPurpose.URL,
                                    hexpand: true,
                                    valign: Gtk.Align.BASELINE });
        this.attach(entry, 1, 1, 1, 1);

        let reset_button = new Gtk.Button({ label: "Reset",
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.BASELINE });
        reset_button.connect('clicked', Lang.bind(this, this._onReset));
        this.attach(reset_button, 2, 1, 1, 1);
        this._settings.bind('configuration-uri', entry, 'text', Gio.SettingsBindFlags.DEFAULT);

        autoSwitch.connect('notify::active', Lang.bind(this, this._onSwitch));
        this._onSwitch(autoSwitch);
    },

    _onSwitch : function(obj, pspec) {
        // set all widgets in row == 1 to sensitive/insensitive
        for (let col = 0; col < 3; col++) {
            let widget = this.get_child_at(col, 1);
            widget.set_sensitive(! obj.active);
        }
    },

    _onReset : function(button) {
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
