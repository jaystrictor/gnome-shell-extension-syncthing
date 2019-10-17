---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Version information:**
 - OS: [e.g. Ubuntu 18.10]
 - `gnome-shell --version` [e.g. GNOME Shell 3.30.1]
 - `gjs --version` [e.g. gjs 1.54.3]
 - Extension version. Either via `grep '"version' ~/.local/share/gnome-shell/extensions/syncthingicon@jay.strict@posteo.de/metadata.json`
   or via the git commit hash.

**Logs**
Add the output of
```
systemctl --user -n0 status syncthing.service
journalctl -b /usr/bin/gnome-shell | grep syncthingicon
```
