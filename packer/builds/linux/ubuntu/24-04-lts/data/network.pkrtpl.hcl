  network:
    network:
      version: 2
      ethernets:
        # Ubuntu 24.04 on vSphere vmx-22 names the vmxnet3 ens33 (enp2s1), not
        # the historical default ens192. Match all ethernet devices so first
        # boot gets an address regardless of PCI slot naming.
%{ if ip != null ~}
        ${device}:
          match:
            name: en*
          dhcp4: false
          addresses:
            - ${ip}/${netmask}
          gateway4: ${gateway}
          nameservers:
            addresses:
%{ for item in dns ~}
              - ${item}
%{ endfor ~}
%{ else ~}
        ${device}:
          match:
            name: en*
          dhcp4: true
%{ endif ~}
