{ config, lib, pkgs, ... }: let
  cfg = config.services.lamacloud-auth-addon;
in {
  options.services.lamacloud-auth-addon = {
    enable = lib.mkEnableOption "lamacloud-auth-addon (custom Zitadel login UI)";

    package = lib.mkPackageOption pkgs "lamacloud-auth-addon" { };

    configFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/lamacloud-auth-addon/config.json";
      description = ''
        Path of config.json on the target machine (see packages/server/config.example.json).
        It holds secrets, so it can stay root-only: the service reads it via LoadCredential.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.lamacloud-auth-addon = {
      description = "LamaCloud Centralized Auth";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      # Restart whenever anything shipped under /etc/lamacloud-auth-addon changes.
      restartTriggers = lib.mapAttrsToList (_: it: it.source)
        (lib.filterAttrs (name: _: lib.hasPrefix "lamacloud-auth-addon/" name) config.environment.etc);
      serviceConfig = {
        ExecStart = "${lib.getExe cfg.package} --config %d/config.json";
        LoadCredential = "config.json:${cfg.configFile}";
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        CapabilityBoundingSet = "";
      };
    };
  };
}
