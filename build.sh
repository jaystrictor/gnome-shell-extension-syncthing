#!/bin/sh

glib-compile-schemas schemas/

rm syncthingicon.zip
zip -j syncthingicon.zip src/*
zip -r syncthingicon.zip icons/* schemas/*
