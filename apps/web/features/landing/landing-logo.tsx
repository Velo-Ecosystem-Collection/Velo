export function LandingLogo() {
  return (
    <div className="w-40 shrink-0 sm:w-44">
      <img
        src="/velo-logo-light.png"
        alt="Velo"
        width={612}
        height={190}
        className="block h-auto w-full dark:hidden"
      />
      <img
        src="/velo-logo-dark.png"
        alt="Velo"
        width={612}
        height={190}
        className="hidden h-auto w-full dark:block"
      />
    </div>
  );
}
