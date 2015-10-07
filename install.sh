#!/bin/sh

INSTALL_DIR=$HOME/.local/share/gnome-shell/extensions/syncthingicon@jay.strict@posteo.de

glib-compile-schemas schemas/

mkdir -p $INSTALL_DIR

cp convenience.js $INSTALL_DIR/
cp extension.js $INSTALL_DIR/
cp prefs.js $INSTALL_DIR/
cp metadata.json $INSTALL_DIR/
cp -R icons/ $INSTALL_DIR/
cp -R schemas/ $INSTALL_DIR/
