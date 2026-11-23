# Gotchas (and where the fix lives)

Seven things that broke on the way to a green RHEL 9 build (plus three
Orchestrator-side notes at the end). Each one gets the
full story in the blog series; this is the quick map from symptom to fix.

| # | Symptom | Fix | Where |
|---|---------|-----|-------|
| 1 | Kickstart can't find packages / install source | Use the full **DVD** ISO, not the small boot ISO. The kickstart installs from the attached media (`cdrom`), and the boot ISO has no BaseOS/AppStream repos on it. | `packer/config/example/linux-*-9.pkrvars.hcl.example` |
| 2 | Uploading a ~16 GB ISO through the vSphere UI stalls or times out | Stream it straight to the datastore over vCenter's `/folder` HTTP endpoint with `curl -T` (example below). | this page |
| 3 | RHSM registration fails when the password contains `&` (or `$`, `;`, quotes...) | The kickstart receives the credentials **base64-encoded** via Packer's `base64encode()`, decodes them in `%post`, and passes them **quoted**. Ansible then fails fast if the system is still not registered. | `packer/builds/linux/rhel/9/data/ks.pkrtpl.hcl`, `packer/ansible/roles/base/tasks/redhat.yml` |
| 4 | The GitHub Actions step is green even though Packer failed | `build.sh --auto-continue` used to fall through to the interactive menu and exit 0. It now records Packer's status and `exit`s with it. | `packer/build.sh` (`build_status`) |
| 5 | Failed builds leave VMs / half-built items behind, or CI hangs at a prompt | Noninteractive runs (`--auto-continue` or `CI=true`) use `packer build -on-error=abort` instead of `-on-error=ask`. | `packer/build.sh` (`packer_on_error`) |
| 6 | `Timeout waiting for IP` on RHEL builds | RHEL install + `%post` RHSM registration + CDN downloads can take ~25 minutes on nested hosts. `common_ip_wait_timeout` is raised to `60m`. | `packer/config/example/common.pkrvars.hcl.example` |
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

## Orchestrator side

| # | Symptom | Fix / note | Where |
|---|---------|------------|-------|
| 8 | An Orchestrator run sits "running" for hours | The check-run / sleep 60s loop used to have **no maximum**, so a stuck GitHub run kept it polling forever. It now stops after the `timeoutMinutes` attribute (default 90), cancels the GitHub run, and posts FAILED with `Status: timed_out`. The token needs Actions write for the cancel. | `orchestrator/scripts/image-build/03-check-goldrush-run-status.js`, `orchestrator/README.md` (Poll timeout) |
| 9 | "Why is the failed build event INFORMATION?" | All three events are posted as `INFORMATION`; the Failed alert is critical only because its **symptom definition** is Critical. | `orchestrator/scripts/post-vcf-operations-event/`, `vcf-operations/` |
| 10 | Workflow only works against one vCenter | The original version hardcoded the vCenter FQDN in the resource lookup (script and REST URL). It's now the `vCenterName` attribute of the `goldRush-VCFOps` config element. | `orchestrator/config-elements/goldRush-VCFOps.example.json` |

## Ubuntu 24.04 LTS

| # | Symptom | Fix / note | Where |
|---|---------|------------|-------|
| 11 | Ubuntu autoinstall never starts, or Packer waits on an interactive installer | `vm_boot_order` must be `cdrom,disk`. The upstream template default is `disk,cdrom`. | `packer/config/example/linux-ubuntu-24-04-lts.pkrvars.hcl.example` |
| 12 | A deployed VM ignores VCF Automation `cloudConfig` | Set `vm_guest_os_cloudinit = true`. The Ansible playbook default is `false`, which **removes** the cloud-init package on Ubuntu. With it true, the Debian `configure` role keeps cloud-init, writes `datasource_list: [ VMware, OVF, None ]`, and runs `cloud-init clean --machine-id`. | `packer/ansible/roles/configure/tasks/debian.yml`, `packer/ansible/roles/clean/tasks/debian.yml` |
| 13 | Autoinstall fails with "storage" or volume-group errors on a 25 GB disk | The shared `linux-storage.pkrvars.hcl` LVM layout is sized for 40 GB and will not fit. Override storage in the Ubuntu OS vars (EFI + boot + swap + ext4 root). | `packer/config/example/linux-ubuntu-24-04-lts.pkrvars.hcl.example` |
| 14 | `build.sh` cannot find `builds/linux/ubuntu/24-04-lts/` | Pass `--version 24.04`, not `24.04 LTS` and not `9`. The helper turns `24.04` into the `24-04-lts` directory name. The goldRush workflow now passes `OS_PACKER_VERSION` per `os` profile. | `packer/build.sh`, `.github/workflows/golden-image.yml` |
