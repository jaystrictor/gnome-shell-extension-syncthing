"use strict";

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SyncthingIconPrefsWidget = GObject.registerClass(
class SyncthingIconPrefsWidget extends Gtk.Grid {
    _init(settings) {
        super._init();
        this._settings = settings;

        this.margin = 18;
        this.row_spacing = this.column_spacing = 12;
        this.orientation = Gtk.Orientation.HORIZONTAL;

        let methodLabel = "<b>" + _("Automatic Configuration") + "</b>";
        this.attach(new Gtk.Label({ label: methodLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 0, 1, 1);

        let autoSwitch = new Gtk.Switch({ halign: Gtk.Align.START,
                                            valign: Gtk.Align.BASELINE });
        this.attach(autoSwitch, 1, 0, 2, 1);
        this._settings.bind("autoconfig", autoSwitch, "active", Gio.SettingsBindFlags.DEFAULT);

        let presentLabel = "<b>" + _("Alternative Web Interface URI") + "</b>";
        this.attach(new Gtk.Label({ label: presentLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 1, 1, 1);

        let uriEntry = new Gtk.Entry({ input_purpose: Gtk.InputPurpose.URL,
                                       hexpand: true,
                                       valign: Gtk.Align.BASELINE });
        this.attach(uriEntry, 1, 1, 1, 1);

        let reset_button = new Gtk.Button({ label: "Reset",
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.BASELINE });
        reset_button.connect("clicked", this._onReset.bind(this));
        this.attach(reset_button, 2, 1, 1, 1);
        this._settings.bind("configuration-uri", uriEntry, "text", Gio.SettingsBindFlags.DEFAULT);

        let apiKeyLabel = "<b>" + _("API Key") + "</b>";
        this.attach(new Gtk.Label({ label: apiKeyLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 2, 1, 1);

        let apiKeyEntry = new Gtk.Entry({ input_purpose: Gtk.InputPurpose.FREE_FORM,
                                          hexpand: true,
                                          valign: Gtk.Align.BASELINE });
        this.attach(apiKeyEntry, 1, 2, 1, 1);
        this._settings.bind("api-key", apiKeyEntry, "text", Gio.SettingsBindFlags.DEFAULT);

        let externalBrowserLabel = "<b>" + _("Always use external browser") + "</b>";
        this.attach(new Gtk.Label({ label: externalBrowserLabel,
                                    use_markup: true,
                                    halign: Gtk.Align.END,
                                    valign: Gtk.Align.BASELINE }),
                    0, 3, 1, 1);

        let externalBrowserSwitch = new Gtk.Switch({ halign: Gtk.Align.START,
                                                     valign: Gtk.Align.BASELINE });
        this.attach(externalBrowserSwitch, 1, 3, 2, 1);
        this._settings.bind("external-browser", externalBrowserSwitch, "active", Gio.SettingsBindFlags.DEFAULT);


        autoSwitch.connect("notify::active", this._onSwitch.bind(this));
        this._onSwitch(autoSwitch);
    }

    _onSwitch(obj, pspec) {
        // set all widgets in rows 1 and 2 to sensitive/insensitive
        for (let row = 1; row <= 2; row++) {
            for (let col = 0; col < 3; col++) {
                let widget = this.get_child_at(col, row);
                if (widget)
                    widget.set_sensitive(! obj.active);
            }
        }
    }

    _onReset(button) {
        this._settings.reset("configuration-uri");
    }
});


export default class SystemMonitorExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        const widget = new SyncthingIconPrefsWidget(this.getSettings());

        group.add(widget);
        page.add(group);
        window.add(page);
    }
}