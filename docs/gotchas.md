# Gotchas (and where the fix lives)

Seven things that broke on the way to a green RHEL 9 build. Each one gets the
full story in the blog series; this is the quick map from symptom to fix.

| # | Symptom | Fix | Where |
|---|---------|-----|-------|
| 1 | Kickstart can't find packages / install source | Use the full **DVD** ISO, not the small boot ISO. The kickstart installs from the attached media (`cdrom`), and the boot ISO has no BaseOS/AppStream repos on it. | `packer/config/example/linux-*-9.pkrvars.hcl.example` |
| 2 | Uploading a ~16 GB ISO through the vSphere UI stalls or times out | Stream it straight to the datastore over vCenter's `/folder` HTTP endpoint with `curl -T` (example below). | this page |
| 3 | RHSM registration fails when the password contains `&` (or `$`, `;`, quotes...) | The kickstart receives the credentials **base64-encoded** via Packer's `base64encode()`, decodes them in `%post`, and passes them **quoted**. Ansible then fails fast if the system is still not registered. | `packer/builds/linux/rhel/9/data/ks.pkrtpl.hcl`, `packer/ansible/roles/base/tasks/redhat.yml` |
| 4 | The GitHub Actions step is green even though Packer failed | `build.sh --auto-continue` used to fall through to the interactive menu and exit 0. It now records Packer's status and `exit`s with it. | `packer/build.sh` (`build_status`) |
| 5 | Failed builds leave VMs / half-built items behind, or CI hangs at a prompt | Noninteractive runs (`--auto-continue` or `CI=true`) use `packer build -on-error=abort` instead of `-on-error=ask`. | `packer/build.sh` (`packer_on_error`) |
| 6 | `Timeout waiting for IP` on RHEL builds | RHEL install + `%post` RHSM registration + CDN downloads can take ~25 minutes on lab hardware. `common_ip_wait_timeout` is raised to `60m`. | `packer/config/example/common.pkrvars.hcl.example` |
| 7 | New image never shows up in the subscribed library | A stale VMDK left in the source item blocked the library-level sync. Clean up leftover files from failed builds, then let the pipeline trigger a library-level sync for new items before the item-level sync. | `scripts/sync-subscribed-library-item.sh` |

## Uploading a large ISO with curl

```bash
# Placeholders: vcenter.example.com, <DATACENTER>, <ISO_DATASTORE>.
# Prompts for the password instead of putting it on the command line.
curl -k -u '<VSPHERE_USER>@vsphere.local' \
  -T rhel-9.9-x86_64-dvd.iso \
  "https://vcenter.example.com/folder/iso/linux/rhel/9/amd64/rhel-9.9-x86_64-dvd.iso?dcPath=<DATACENTER>&dsName=<ISO_DATASTORE>"
```

The path after `/folder/` must match `iso_datastore_path` + `iso_file` in your
OS vars file.
