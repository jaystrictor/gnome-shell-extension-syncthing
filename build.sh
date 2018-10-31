#!/bin/sh

glib-compile-schemas schemas/

rm syncthingicon.zip
zip -j syncthingicon.zip src/*
zip syncthingicon.zip icons/* schemas/*
