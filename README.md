# Syncthing Gnome Shell extension

![ScreenShot](https://extensions.gnome.org/extension-data/screenshots/screenshot_989_b97mez4.png)

This is a simple shell extension for Gnome 3.
It displays a small symbolic Syncthing icon with the following features
- automatic file parsing of `~/.config/syncthing/config.xml` to obtain configuration IP and port
- status summary indication of Syncthing (`idle` / `syncing` / `error` / `unknown`)
- an on/off switch for starting/stopping Syncthing
- a button for opening the Web user interface (http://localhost:8384 or some other configurable URI)
- a list of folders that are managed by Syncthing with status indication of each folder (`idle` / `syncing` / `error` / `unknown`)

## Requirements

This extension uses the **user service** management facilities of systemd. The
[Syncthing documentation](https://docs.syncthing.net/users/autostart.html#how-to-set-up-a-user-service)
has information about how to set this up. Please make sure that you have the
user units installed correctly, otherwise the on/off switch will not work.

## Installation

### extensions.gnome.org

The easiest way to install the Syncthing Icon will be from the
[Gnome Extensions website](https://extensions.gnome.org/extension/989/syncthing-icon/).
You can install and activate the extension all at once by clicking the switch to
ON, and next to the switch, you can click the wrench icon to configure the
extension, in case you need to change the port number for the Syncthing web
client.

If you have any trouble with this, see the Gnome Shell Extensions site's
[FAQ page](https://extensions.gnome.org/about/).

### installing manually

The install script will make sure all the necessary files are copied to the
correct place for you.
```sh
./install.sh
```

After that, all you have to do is enable Syncthing Icon in your list of shell
extensions. Gnome Shell comes with a simple GUI application that lists all the
extensions that you have currently installed, but for some reason it does not
normally show up when you search the application menu. You have to launch it
from the terminal, or from the Run Commands dialog (`Alt-F2`). Enter this:
```sh
gnome-shell-extension-prefs &
```

Alternatively, you can use Gnome Tweak Tool to configure the extension.

## Debugging

For debugging purposes you should look at the log output of gnome-shell. If you have systemd, the following command should print all the important log messages:
```sh
journalctl -b /usr/bin/gnome-shell -g syncthingicon
```
If this gives you `Compiled without pattern matching support`, then instead use this:
```sh
journalctl -b /usr/bin/gnome-shell | grep syncthingicon
```

## powered by
### Font Awesome by Dave Gandy - http://fontawesome.io
The glyphs `database.svg`, `exclamation-triangle.svg`, `question.svg`, `exchange.svg`, and `pause.svg` are extracted from Font Awesome. They are licensed under the [SIL OFL 1.1](http://scripts.sil.org/OFL).

### saxes by Louis-Dominique Dubeau - https://github.com/lddubeau/saxes
The file `saxes.js` is licensed under the ISC license, part of it under the MIT license. Please see the header of this file for details.
