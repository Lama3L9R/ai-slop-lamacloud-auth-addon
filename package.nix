{
  lib,
  stdenv,
  fetchFromGitHub,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm_10,
  nodejs,
  makeWrapper,
}:
let
  # matches the lockfile / packageManager field (pnpm 10)
  pnpm = pnpm_10;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "lamacloud-auth-addon";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "Lama3L9R";
    repo = "ai-slop-lamacloud-auth-addon";
    rev = "v${finalAttrs.version}";
    hash = lib.fakeHash; # TODO
  };

  # depends only on package.json / pnpm-lock.yaml; refresh with lib.fakeHash after changing deps
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-GmalhxkQGQR0keGNLu5q23tfDk4fQN+87taH0Qf0cyc=";
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  # server -> packages/server/dist, web -> packages/web/dist
  buildPhase = ''
    runHook preBuild
    pnpm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app=$out/lib/${finalAttrs.pname}

    # standalone copy of the server package with only its runtime dependencies
    pnpm --offline --filter @lamacloud-auth/server deploy --prod --legacy $app/server
    # pnpm leaves a self-link pointing back into the build directory
    rm -r $app/server/node_modules/.pnpm/node_modules/@lamacloud-auth
    cp -r packages/web/dist $app/web

    makeWrapper ${lib.getExe nodejs} $out/bin/${finalAttrs.pname} \
      --add-flags $app/server/dist/index.js \
      --add-flags "--web-root $app/web"

    runHook postInstall
  '';

  meta = {
    description = "Custom Zitadel login UI with Yubico OTP";
    homepage = "https://github.com/Lama3L9R/ai-slop-lamacloud-auth-addon";
    license = "Anti-996";
    mainProgram = finalAttrs.pname;
    platforms = lib.platforms.linux;
  };
})
