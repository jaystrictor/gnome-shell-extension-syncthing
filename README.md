# Syncthing Gnome Shell extension

This is a simple shell extension for Gnome 3.
It features a small symbolic Syncthing icon that opens a menu with
- an on/off switch for starting/stopping Syncthing byutilizing `systemd`
- a button for opening the Web user interface
- a list of folders that are managed by Syncthing

## Install
Copy the files:
```sh
mkdir -p ~/.local/share/gnome-shell/extensions/syncthingicon@jay.strict@posteo.de
cp -R * ~/.local/share/gnome-shell/extensions/syncthingicon@jay.strict@posteo.de/
```

Activate:
```sh
gnome-shell-extension-prefs &
```
