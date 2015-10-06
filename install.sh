#!/bin/sh

INSTALL_DIR=$HOME/.local/share/gnome-shell/extensions/syncthingicon@jay.strict@posteo.de

mkdir -p $INSTALL_DIR

cp extension.js $INSTALL_DIR/
cp metadata.json $INSTALL_DIR/
cp -R icons/ $INSTALL_DIR/
