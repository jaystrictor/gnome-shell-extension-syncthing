# Syncthing Gnome Shell extension

This is a simple shell extension for Gnome 3.
It features a small symbolic Syncthing icon that opens a menu with
- an on/off switch for starting/stopping Syncthing by utilizing `systemctl --user`
- a button for opening the Web user interface (http://localhost:8384 or some other configurable URI)
- a list of folders that are managed by Syncthing

## Installation
To install, just run:
```sh
./install.sh
```

Activate:
```sh
gnome-shell-extension-prefs &
```
