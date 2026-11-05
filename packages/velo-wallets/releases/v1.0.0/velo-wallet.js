//#region \0rolldown/runtime.js
var e = Object.defineProperty, t = (e, t, n) => () => {
	if (n) throw n[0];
	try {
		return e && (t = e(e = 0)), t;
	} catch (e) {
		throw n = [e], e;
	}
}, n = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), r = (t, n) => {
	let r = {};
	for (var i in t) e(r, i, {
		get: t[i],
		enumerable: !0
	});
	return n || e(r, Symbol.toStringTag, { value: "Module" }), r;
}, i = /* @__PURE__ */ ((e) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(e, { get: (e, t) => (typeof require < "u" ? require : e)[t] }) : e)(function(e) {
	if (typeof require < "u") return require.apply(this, arguments);
	throw Error("Calling `require` for \"" + e + "\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.");
}), a = {
	system: "ui-sans-serif, system-ui, sans-serif",
	serif: "ui-serif, Georgia, Cambria, serif",
	mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
}, o = {
	sm: ".45rem .7rem",
	md: ".65rem 1rem",
	lg: ".8rem 1.25rem"
}, s = {
	square: "0",
	rounded: ".625rem",
	pill: "999px"
}, c = {
	sm: ".375rem",
	md: ".75rem",
	lg: "1rem"
}, l = {
	none: "none",
	sm: "0 4px 12px rgba(0, 0, 0, .12)",
	md: "0 18px 48px rgba(0, 0, 0, .22)"
};
function u(e, t = !1) {
	return e === "dark" || e === "system" && t;
}
function d(e, t = !1) {
	return u(e.theme, t) ? e.palettes.dark : e.palettes.light;
}
function f(e, t = !1) {
	let n = d(e, t);
	return {
		background: n.background,
		"background-secondary": n.surface,
		"foreground-strong": n.text,
		foreground: n.text,
		"foreground-secondary": n.mutedText,
		primary: n.accent,
		"primary-foreground": n.accentText,
		transparent: "rgba(0, 0, 0, 0)",
		lighter: n.surface,
		light: n.surfaceMuted,
		"light-gray": n.border,
		gray: n.mutedText,
		danger: n.danger,
		border: n.border,
		shadow: l[e.modal.shadow],
		"border-radius": c[e.modal.radius],
		"font-family": a[e.fontFamily]
	};
}
function p(e, t) {
	let n = e.button.variant === "solid", r = e.button.variant === "outline";
	return {
		"--velo-wallet-background": t.background,
		"--velo-wallet-surface": t.surface,
		"--velo-wallet-surface-muted": t.surfaceMuted,
		"--velo-wallet-text": t.text,
		"--velo-wallet-muted-text": t.mutedText,
		"--velo-wallet-accent": t.accent,
		"--velo-wallet-accent-text": t.accentText,
		"--velo-wallet-border": t.border,
		"--velo-wallet-danger": t.danger,
		"--velo-wallet-focus-ring": t.focusRing,
		"--velo-wallet-font-family": a[e.fontFamily],
		"--velo-wallet-button-background": n ? t.accent : r ? "transparent" : t.surfaceMuted,
		"--velo-wallet-button-text": n ? t.accentText : t.accent,
		"--velo-wallet-button-border": r ? t.accent : t.border,
		"--velo-wallet-button-padding": o[e.button.size],
		"--velo-wallet-button-radius": s[e.button.radius],
		"--velo-wallet-modal-radius": c[e.modal.radius],
		"--velo-wallet-shadow": l[e.modal.shadow]
	};
}
function m(e) {
	return Object.entries(e).map(([e, t]) => `${e}:${t}`).join(";");
}
//#endregion
//#region src/errors.ts
var h = class extends Error {
	code;
	cause;
	constructor(e, t, n) {
		super(t), this.name = "VeloWalletError", this.code = e, this.cause = n;
	}
};
function g(e) {
	return e instanceof Error ? e.message : typeof e == "string" ? e : typeof e == "object" && e && "message" in e && typeof e.message == "string" ? e.message : "Unknown wallet error";
}
function _(e, t) {
	if (e instanceof h) return e;
	let n = g(e);
	return /reject|denied|cancel/i.test(n) ? new h(t === "SIGNING_FAILED" ? "SIGNING_REJECTED" : "CONNECTION_REJECTED", n, e) : /popup|window.*blocked/i.test(n) ? new h("POPUP_BLOCKED", n, e) : /not support|unsupported method|not implemented/i.test(n) ? new h("WALLET_METHOD_UNSUPPORTED", n, e) : new h(t, n, e);
}
//#endregion
//#region src/config.ts
var v = [
	{
		id: "albedo",
		name: "Albedo"
	},
	{
		id: "freighter",
		name: "Freighter"
	},
	{
		id: "fordefi",
		name: "Fordefi"
	},
	{
		id: "rabet",
		name: "Rabet"
	},
	{
		id: "xbull",
		name: "xBull"
	},
	{
		id: "lobstr",
		name: "LOBSTR"
	},
	{
		id: "hana",
		name: "Hana Wallet"
	},
	{
		id: "klever",
		name: "Klever Wallet"
	},
	{
		id: "onekey",
		name: "OneKey Wallet"
	},
	{
		id: "BitgetWallet",
		name: "Bitget Wallet"
	},
	{
		id: "cactuslink",
		name: "Cactus Link"
	},
	{
		id: "noir",
		name: "Noir"
	}
].map((e) => ({
	...e,
	transactionSigning: !0,
	authEntrySigning: "wallet-dependent",
	messageSigning: "wallet-dependent"
})), y = v.map((e) => e.id), b = {
	palettes: {
		light: {
			background: "#FFFFFF",
			surface: "#F4F4F5",
			surfaceMuted: "#E4E4E7",
			text: "#18181B",
			mutedText: "#52525B",
			accent: "#18181B",
			accentText: "#FFFFFF",
			border: "#71717A",
			danger: "#B91C1C",
			focusRing: "#2563EB"
		},
		dark: {
			background: "#09090B",
			surface: "#18181B",
			surfaceMuted: "#27272A",
			text: "#FAFAFA",
			mutedText: "#D4D4D8",
			accent: "#FAFAFA",
			accentText: "#18181B",
			border: "#A1A1AA",
			danger: "#F87171",
			focusRing: "#60A5FA"
		}
	},
	fontFamily: "system",
	button: {
		variant: "solid",
		size: "md",
		radius: "rounded"
	},
	modal: {
		radius: "md",
		shadow: "md"
	}
}, x = {
	network: "testnet",
	walletIds: ["freighter"],
	theme: "system",
	buttonLabel: "Connect wallet",
	appearance: b,
	showInstallLabel: !0,
	hideUnsupportedWallets: !1,
	persistSession: !0,
	allowedOrigins: ["http://localhost:3000"]
}, S = /^#[0-9A-Fa-f]{6}$/, C = [
	"system",
	"serif",
	"mono"
], w = [
	"solid",
	"outline",
	"soft"
], T = [
	"sm",
	"md",
	"lg"
], E = [
	"square",
	"rounded",
	"pill"
], D = [
	"sm",
	"md",
	"lg"
], O = [
	"none",
	"sm",
	"md"
];
function k() {
	return {
		...b,
		palettes: {
			light: { ...b.palettes.light },
			dark: { ...b.palettes.dark }
		},
		button: { ...b.button },
		modal: { ...b.modal }
	};
}
function A(e, t) {
	return Object.fromEntries(Object.entries({
		...t,
		...e
	}).map(([e, t]) => [e, typeof t == "string" && S.test(t) ? t.toUpperCase() : t]));
}
function j(e, t) {
	return t ? {
		theme: t.theme ?? e.theme,
		buttonLabel: t.buttonLabel?.trim() || e.buttonLabel,
		palettes: {
			light: A(t.palettes?.light, e.palettes.light),
			dark: A(t.palettes?.dark, e.palettes.dark)
		},
		fontFamily: t.fontFamily ?? e.fontFamily,
		button: {
			...e.button,
			...t.button
		},
		modal: {
			...e.modal,
			...t.modal
		}
	} : e;
}
function M(e) {
	let t = k(), n = e.appearance ?? e;
	return {
		theme: e.theme,
		buttonLabel: e.buttonLabel.trim(),
		palettes: {
			light: A(n.palettes?.light, t.palettes.light),
			dark: A(n.palettes?.dark, t.palettes.dark)
		},
		fontFamily: n.fontFamily ?? t.fontFamily,
		button: {
			...t.button,
			...n.button
		},
		modal: {
			...t.modal,
			...n.modal
		}
	};
}
function N(e) {
	return [
		1,
		3,
		5
	].map((t) => Number.parseInt(e.slice(t, t + 2), 16)).map((e) => e / 255).map((e) => e <= .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4).reduce((e, t, n) => e + t * [
		.2126,
		.7152,
		.0722
	][n], 0);
}
function P(e, t) {
	if (!S.test(e) || !S.test(t)) return 0;
	let [n, r] = [N(e), N(t)].sort((e, t) => t - e);
	return (n + .05) / (r + .05);
}
function F(e) {
	let t = [], n = [["Light", e.palettes.light], ["Dark", e.palettes.dark]];
	for (let [e, r] of n) {
		for (let [n, i] of Object.entries(r)) S.test(i) || t.push(`${e} ${n} must use #RRGGBB format.`);
		let n = [
			[
				"text and background",
				r.text,
				r.background,
				4.5
			],
			[
				"text and surface",
				r.text,
				r.surface,
				4.5
			],
			[
				"muted text and background",
				r.mutedText,
				r.background,
				4.5
			],
			[
				"accent text and accent",
				r.accentText,
				r.accent,
				4.5
			],
			[
				"focus ring and background",
				r.focusRing,
				r.background,
				3
			],
			[
				"border and background",
				r.border,
				r.background,
				3
			]
		];
		for (let [r, i, a, o] of n) S.test(i) && S.test(a) && P(i, a) < o && t.push(`${e} ${r} contrast must be at least ${o}:1.`);
	}
	return C.includes(e.fontFamily) || t.push("Choose a supported font family."), w.includes(e.button.variant) || t.push("Choose a supported button variant."), T.includes(e.button.size) || t.push("Choose a supported button size."), E.includes(e.button.radius) || t.push("Choose a supported button radius."), D.includes(e.modal.radius) || t.push("Choose a supported modal radius."), O.includes(e.modal.shadow) || t.push("Choose a supported modal shadow."), t;
}
function I(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function L(e) {
	if (!("palettes" in e)) return !0;
	let t = e.palettes, n = e.button, r = e.modal;
	if (!I(t) || !I(t.light) || !I(t.dark)) return !1;
	let i = t.light, a = t.dark;
	return !(!Object.keys(b.palettes.light).every((e) => typeof i[e] == "string" && typeof a[e] == "string") || !C.includes(e.fontFamily) || !I(n) || !w.includes(n.variant) || !T.includes(n.size) || !E.includes(n.radius) || !I(r) || !D.includes(r.radius) || !O.includes(r.shadow));
}
function R(e) {
	if (!I(e) || e.schemaVersion !== 1 || e.runtimeMajor !== 1) throw new h("CONFIG_INCOMPATIBLE", "CONFIG_INCOMPATIBLE: Velo Wallets configuration is not compatible with runtime v1.");
	let t = e.appearance, n = e.modal, r = e.session;
	if (typeof e.revision != "number" || typeof e.projectKey != "string" || e.network !== "testnet" && e.network !== "public" || !Array.isArray(e.walletIds) || e.walletIds.some((e) => typeof e != "string" || !y.includes(e)) || !I(t) || ![
		"light",
		"dark",
		"system"
	].includes(String(t.theme)) || typeof t.buttonLabel != "string" || !L(t) || !I(n) || typeof n.showInstallLabel != "boolean" || typeof n.hideUnsupportedWallets != "boolean" || !I(r) || typeof r.persist != "boolean") throw new h("CONFIG_INCOMPATIBLE", "CONFIG_INCOMPATIBLE: Published wallet configuration is malformed.");
	let i = M(t);
	if (F(i).length > 0) throw new h("CONFIG_INCOMPATIBLE", "CONFIG_INCOMPATIBLE: Published wallet appearance is malformed or inaccessible.");
	return {
		schemaVersion: 1,
		revision: e.revision,
		runtimeMajor: 1,
		projectKey: e.projectKey,
		network: e.network,
		walletIds: e.walletIds,
		appearance: i,
		modal: n,
		session: r
	};
}
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/types/components.js
var z, B, V, H, ee = t((() => {
	z = /*#__PURE__*/ function(e) {
		return e.AUTH_OPTIONS = "AUTH_OPTIONS", e.HELP_PAGE = "HELP_PAGE", e.PROFILE_PAGE = "PROFILE_PAGE", e.HW_ACCOUNTS_FETCHER = "HW_ACCOUNTS_FETCHER", e;
	}({}), B = /*#__PURE__*/ function(e) {
		return e.FIXED = "FIXED", e.BLOCK = "BLOCK", e.HIDDEN = "HIDDEN", e;
	}({}), V = {
		background: "#fcfcfcff",
		"background-secondary": "#f8f8f8ff",
		"foreground-strong": "#000000",
		foreground: "#161619ff",
		"foreground-secondary": "#2d2d31ff",
		primary: "#3b82f6",
		"primary-foreground": "#ffffff",
		transparent: "rgba(0, 0, 0, 0)",
		lighter: "#fcfcfc",
		light: "#f8f8f8",
		"light-gray": "oklch(0.800 0.006 286.033)",
		gray: "oklch(0.600 0.006 286.033)",
		danger: "oklch(57.7% 0.245 27.325)",
		border: "rgba(0, 0, 0, 0.15)",
		shadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
		"border-radius": "0.5rem",
		"font-family": "sans-serif"
	}, H = {
		background: "oklch(0.333 0 89.876)",
		"background-secondary": "oklch(0 0 0)",
		"foreground-strong": "#fff",
		foreground: "oklch(0.985 0 0)",
		"foreground-secondary": "oklch(0.97 0 0)",
		primary: "#e0e0e0",
		"primary-foreground": "#1e1e1e",
		transparent: "rgba(0, 0, 0, 0)",
		lighter: "#fcfcfc",
		light: "#f8f8f8",
		"light-gray": "oklch(0.800 0.006 286.033)",
		gray: "oklch(0.600 0.006 286.033)",
		danger: "oklch(57.7% 0.245 27.325)",
		border: "rgba(58,58,58,0.15)",
		shadow: "0 10px 15px -3px rgba(255, 255, 255, 0.1), 0 4px 6px -4px rgba(255, 255, 255, 0.1)",
		"border-radius": "0.5rem",
		"font-family": "sans-serif"
	};
})), U = t((() => {})), W, te = t((() => {
	W = /*#__PURE__*/ function(e) {
		return e.usedWalletsIds = "@StellarWalletsKit/usedWalletsIds", e.activeAddress = "@StellarWalletsKit/activeAddress", e.selectedModuleId = "@StellarWalletsKit/selectedModuleId", e.hardwareWalletPaths = "@StellarWalletsKit/hardwareWalletPaths", e.wcSessionPaths = "@StellarWalletsKit/wcSessionPaths", e;
	}({});
})), G, K, ne, q = t((() => {
	ee(), U(), te(), G = /*#__PURE__*/ function(e) {
		return e.PUBLIC = "Public Global Stellar Network ; September 2015", e.TESTNET = "Test SDF Network ; September 2015", e.FUTURENET = "Test SDF Future Network ; October 2022", e.SANDBOX = "Local Sandbox Stellar Network ; September 2022", e.STANDALONE = "Standalone Network ; February 2017", e;
	}({}), K = /*#__PURE__*/ function(e) {
		return e.HW_WALLET = "HW_WALLET", e.HOT_WALLET = "HOT_WALLET", e.BRIDGE_WALLET = "BRIDGE_WALLET", e.AIR_GAPED_WALLET = "AIR_GAPED_WALLET", e;
	}({}), ne = /*#__PURE__*/ function(e) {
		return e.STATE_UPDATED = "STATE_UPDATE", e.WALLET_SELECTED = "WALLET_SELECTED", e.DISCONNECT = "DISCONNECT", e;
	}({});
}));
//#endregion
//#region src/noir-module.ts
q();
var re = "noir", ie = "https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl";
function ae() {
	if (typeof window > "u") return null;
	let e = window.noir?.stellar;
	return e?.isNoir === !0 ? e : null;
}
var oe = class {
	moduleType = K.HOT_WALLET;
	productId = re;
	productName = "Noir";
	productUrl = ie;
	productIcon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD0AAABACAMAAACeAI/EAAAAeFBMVEVqY1d0ZlBcUT+CbEqpmHfIxLO1j0vMwarFoWTazK/f1sPAuqe8tKC8s5+Xe06soo2ZekSliFaxmm2bdjWOcD/CvK26rpaenJNxcGlPUlAvNj3OuJDXw5rSqmfCm1Tl2sXt49Dj07Tix5f07+Spgj2jfDoxOEHRp16jjzznAAAAG3RSTlMBLrxa9Lr++vn+/raw4KOa2OL8/Mf2+fT5+fyJotllAAAEQ0lEQVRIx52XDZeiIBSGUwuFtqZy0wwUqaz//w/3foAybbbT3nPmNAqP73v5ZrFYJGmy+DyylH+T5Sr7HF4tWTMTOk8/hFPTikAXUq0/cZ/9UqbzdCq61vabn7vPNr1rO5EFutO2l9ufsclW9rbtRrrruuLS9+or+VFz9X1vCqDTke5aBy9/4D41UM8ViDC9w3/Rew/u38sna9X3V/Qd6IRpgR/t7duuJ9fgu4voG8GicFSUZ+9dg0EhBCI7ogWyEK2lQjXjnlxT0lQb6CSmhe45XrqHTubQwtP7hIaah4WQvoL5a94k6VgmAi2YHsOnDu43z2F9iTvcxursPMTtprnS9VVQiS1uI03Ok31gh4G9X6+zuB6GEec23zGLdHlwszDiUpQTzmPt9wgPZXmYh69XeyhLwD3vxznTBA//pkn9FtOeLYU29g3tYEWZcB4V2W2CpXRv8nZSahHMl35lKoNrbaRzdh52Thp9GBjfMZ2ULNwag/SsONPGFIwHeudTNhJh5+ayRhpxdD8MYRlO2fVIvxa3LuCa3E+0aHVEuznfo7guxER7eKT7WWmgSRzwMI1TeGJpT7tZ6aANEbRXRn8z/krcuidcfvlVI6eOiGn5l7T8Rhvj3MbvRJL7UY7OjX4Wt3rC/bCQnPiaiYmWWj9nLrWJxLkar8gbLzgaB9o8GYdMI+/8u6K05dNbiS36fbQ7bNaR9r8GrW/d+PpY1fVyf1pikz4Z13p5Wi7ruspHD2g9GIfJJZvz+Xw/nxvATdxuPcJQgHFSY+etwTg7sria1gDfPR5bVx6GsnuFKyvT0GdbJP1qrU4gjfx9+a3VpV6efUnNNQGhPtsElDa4hhXOTWy911XDwuB7qmzVerFxEY3eKZo6GjDO+4bXx6guJp4W7WXibX1qmgZk9tXU6rKCjO5NczpVkfKlPWSwsjza9uIiPxJ6DirGdHOCnpJqUnGXtn2ktAs+Hg/g4wR6dZRumpz5UcWF1ukWJPnAlrYP5HVsAEfUNL9k/GmUBYKlcRNFuKUErIdxxvQTPfKWLLcYfk1dpPToDUAtRXBM49hQKKupGooVYWVKdvQ9/1o6hkfa0syFP+PrUL3pZJkVj0A/OjhAfHeONLY3nDk65AgW0dkkZbobjx8W3E+0o76CnX8QwvPxkTwRgYXTTDjfyJojPCMN+xd8YGqyxbSHM9xdokEPo+4U6MPgQwiRPV8zSg932o85BXPjfm5yxWPMHoYb02Wavbim7AnuWoadUjXOZ6UYd4LZ3cwlKElvgg/blmAlT+caf6nVpHjHMr+DXoHlQnEcl5JowK0WQ/k7+8cJPNsJ7WEnq6oiHB8Or9J9cZ7dMeDyCiPnJ/nTO1+yoqSB1Dl+QeKnvj64MpEwsFLmmtyvPrivZUeA85y2thz4fJN9dkdd41pEYap1+ulFNcm2G5iV0tTb7H/uyND7tVy9beo/BoQYdudAjWoAAAAASUVORK5CYII=";
	async isAvailable() {
		return ae() !== null;
	}
	async getAddress(e) {
		let t = this.requireProvider();
		return { address: ce(se(e?.skipRequestAccess ? await t.getAddress() : await t.requestAccess()).address, "address") };
	}
	async signTransaction(e, t) {
		let n = se(await this.requireProvider().signTransaction(e, t));
		return {
			signedTxXdr: ce(n.signedTxXdr, "signed transaction"),
			signerAddress: ce(n.signerAddress, "signer address")
		};
	}
	async signAuthEntry(e, t) {
		let n = se(await this.requireProvider().signAuthEntry(e, t));
		return {
			signedAuthEntry: ce(n.signedAuthEntry, "signed authorization entry"),
			signerAddress: ce(n.signerAddress, "signer address")
		};
	}
	async signMessage(e, t) {
		let n = se(await this.requireProvider().signMessage(e, t));
		return {
			signedMessage: ce(n.signedMessage, "signed message"),
			signerAddress: ce(n.signerAddress, "signer address")
		};
	}
	async getNetwork() {
		let e = se(await this.requireProvider().getNetwork());
		return {
			network: ce(e.network, "network"),
			networkPassphrase: ce(e.networkPassphrase, "network passphrase")
		};
	}
	async hasMatchingSession(e, t) {
		let n = this.requireProvider(), { isAllowed: r } = se(await n.isAllowed());
		if (!r || se(await n.getAddress()).address !== e) return !1;
		if (se(await n.getNetwork()).networkPassphrase !== t) throw new h("NETWORK_MISMATCH", `Switch Noir to ${t === "Public Global Stellar Network ; September 2015" ? "Mainnet" : "Testnet"}.`);
		return !0;
	}
	requireProvider() {
		let e = ae();
		if (!e) throw new h("WALLET_UNAVAILABLE", "Noir Wallet is not available. Install or enable the Noir browser extension.");
		return e;
	}
};
function se(e) {
	if (typeof e == "object" && e && "error" in e) {
		let { code: t, message: n, ext: r } = e.error;
		throw t === -3 && /network/i.test(n) ? new h("NETWORK_MISMATCH", n, e.error) : {
			code: t,
			message: n,
			ext: r?.join(", ")
		};
	}
	return e;
}
function ce(e, t) {
	if (typeof e != "string" || e.length === 0) throw Error(`Noir did not return a valid ${t}.`);
	return e;
}
//#endregion
//#region ../../node_modules/.pnpm/preact@10.29.2/node_modules/preact/dist/preact.module.js
function le(e, t) {
	for (var n in t) e[n] = t[n];
	return e;
}
function ue(e) {
	e && e.parentNode && e.parentNode.removeChild(e);
}
function de(e, t, n) {
	var r, i, a, o = {};
	for (a in t) a == "key" ? r = t[a] : a == "ref" ? i = t[a] : o[a] = t[a];
	if (arguments.length > 2 && (o.children = arguments.length > 3 ? Ie.call(arguments, 2) : n), typeof e == "function" && e.defaultProps != null) for (a in e.defaultProps) o[a] === void 0 && (o[a] = e.defaultProps[a]);
	return fe(e, o, r, i, null);
}
function fe(e, t, n, r, i) {
	var a = {
		type: e,
		props: t,
		key: n,
		ref: r,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: void 0,
		__v: i ?? ++Le,
		__i: -1,
		__u: 0
	};
	return i == null && J.vnode != null && J.vnode(a), a;
}
function pe(e) {
	return e.children;
}
function me(e, t) {
	this.props = e, this.context = t;
}
function he(e, t) {
	if (t == null) return e.__ ? he(e.__, e.__i + 1) : null;
	for (var n; t < e.__k.length; t++) if ((n = e.__k[t]) != null && n.__e != null) return n.__e;
	return typeof e.type == "function" ? he(e) : null;
}
function ge(e) {
	if (e.__P && e.__d) {
		var t = e.__v, n = t.__e, r = [], i = [], a = le({}, t);
		a.__v = t.__v + 1, J.vnode && J.vnode(a), De(e.__P, a, t, e.__n, e.__P.namespaceURI, 32 & t.__u ? [n] : null, r, n ?? he(t), !!(32 & t.__u), i), a.__v = t.__v, a.__.__k[a.__i] = a, ke(r, a, i), t.__e = t.__ = null, a.__e != n && _e(a);
	}
}
function _e(e) {
	if ((e = e.__) != null && e.__c != null) return e.__e = e.__c.base = null, e.__k.some(function(t) {
		if (t != null && t.__e != null) return e.__e = e.__c.base = t.__e;
	}), _e(e);
}
function ve(e) {
	(!e.__d && (e.__d = !0) && ze.push(e) && !ye.__r++ || Be != J.debounceRendering) && ((Be = J.debounceRendering) || Ve)(ye);
}
function ye() {
	try {
		for (var e, t = 1; ze.length;) ze.length > t && ze.sort(He), e = ze.shift(), t = ze.length, ge(e);
	} finally {
		ze.length = ye.__r = 0;
	}
}
function be(e, t, n, r, i, a, o, s, c, l, u) {
	var d, f, p, m, h, g, _, v = r && r.__k || Ze, y = t.length;
	for (c = xe(n, t, v, c, y), d = 0; d < y; d++) (p = n.__k[d]) != null && (f = p.__i != -1 && v[p.__i] || Xe, p.__i = d, g = De(e, p, f, i, a, o, s, c, l, u), m = p.__e, p.ref && f.ref != p.ref && (f.ref && Me(f.ref, null, p), u.push(p.ref, p.__c || m, p)), h == null && m != null && (h = m), (_ = !!(4 & p.__u)) || f.__k === p.__k ? (c = Se(p, c, e, _), _ && f.__e && (f.__e = null)) : typeof p.type == "function" && g !== void 0 ? c = g : m && (c = m.nextSibling), p.__u &= -7);
	return n.__e = h, c;
}
function xe(e, t, n, r, i) {
	var a, o, s, c, l, u = n.length, d = u, f = 0;
	for (e.__k = Array(i), a = 0; a < i; a++) (o = t[a]) != null && typeof o != "boolean" && typeof o != "function" ? (typeof o == "string" || typeof o == "number" || typeof o == "bigint" || o.constructor == String ? o = e.__k[a] = fe(null, o, null, null, null) : $e(o) ? o = e.__k[a] = fe(pe, { children: o }, null, null, null) : o.constructor === void 0 && o.__b > 0 ? o = e.__k[a] = fe(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : e.__k[a] = o, c = a + f, o.__ = e, o.__b = e.__b + 1, s = null, (l = o.__i = Ce(o, n, c, d)) != -1 && (d--, (s = n[l]) && (s.__u |= 2)), s == null || s.__v == null ? (l == -1 && (i > u ? f-- : i < u && f++), typeof o.type != "function" && (o.__u |= 4)) : l != c && (l == c - 1 ? f-- : l == c + 1 ? f++ : (l > c ? f-- : f++, o.__u |= 4))) : e.__k[a] = null;
	if (d) for (a = 0; a < u; a++) (s = n[a]) != null && !(2 & s.__u) && (s.__e == r && (r = he(s)), Ne(s, s));
	return r;
}
function Se(e, t, n, r) {
	var i, a;
	if (typeof e.type == "function") {
		for (i = e.__k, a = 0; i && a < i.length; a++) i[a] && (i[a].__ = e, t = Se(i[a], t, n, r));
		return t;
	}
	e.__e != t && (r && (t && e.type && !t.parentNode && (t = he(e)), n.insertBefore(e.__e, t || null)), t = e.__e);
	do
		t &&= t.nextSibling;
	while (t != null && t.nodeType == 8);
	return t;
}
function Ce(e, t, n, r) {
	var i, a, o, s = e.key, c = e.type, l = t[n], u = l != null && (2 & l.__u) == 0;
	if (l === null && s == null || u && s == l.key && c == l.type) return n;
	if (r > +!!u) {
		for (i = n - 1, a = n + 1; i >= 0 || a < t.length;) if ((l = t[o = i >= 0 ? i-- : a++]) != null && !(2 & l.__u) && s == l.key && c == l.type) return o;
	}
	return -1;
}
function we(e, t, n) {
	t[0] == "-" ? e.setProperty(t, n ?? "") : e[t] = n == null ? "" : typeof n != "number" || Qe.test(t) ? n : n + "px";
}
function Te(e, t, n, r, i) {
	var a, o;
	n: if (t == "style") if (typeof n == "string") e.style.cssText = n;
	else {
		if (typeof r == "string" && (e.style.cssText = r = ""), r) for (t in r) n && t in n || we(e.style, t, "");
		if (n) for (t in n) r && n[t] == r[t] || we(e.style, t, n[t]);
	}
	else if (t[0] == "o" && t[1] == "n") a = t != (t = t.replace(Ke, "$1")), o = t.toLowerCase(), t = o in e || t == "onFocusOut" || t == "onFocusIn" ? o.slice(2) : t.slice(2), e.l ||= {}, e.l[t + a] = n, n ? r ? n[Ge] = r[Ge] : (n[Ge] = qe, e.addEventListener(t, a ? Ye : Je, a)) : e.removeEventListener(t, a ? Ye : Je, a);
	else {
		if (i == "http://www.w3.org/2000/svg") t = t.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
		else if (t != "width" && t != "height" && t != "href" && t != "list" && t != "form" && t != "tabIndex" && t != "download" && t != "rowSpan" && t != "colSpan" && t != "role" && t != "popover" && t in e) try {
			e[t] = n ?? "";
			break n;
		} catch {}
		typeof n == "function" || (n == null || !1 === n && t[4] != "-" ? e.removeAttribute(t) : e.setAttribute(t, t == "popover" && n == 1 ? "" : n));
	}
}
function Ee(e) {
	return function(t) {
		if (this.l) {
			var n = this.l[t.type + e];
			if (t[We] == null) t[We] = qe++;
			else if (t[We] < n[Ge]) return;
			return n(J.event ? J.event(t) : t);
		}
	};
}
function De(e, t, n, r, i, a, o, s, c, l) {
	var u, d, f, p, m, h, g, _, v, y, b, x, S, C, w, T = t.type;
	if (t.constructor !== void 0) return null;
	128 & n.__u && (c = !!(32 & n.__u), a = [s = t.__e = n.__e]), (u = J.__b) && u(t);
	n: if (typeof T == "function") try {
		if (_ = t.props, v = T.prototype && T.prototype.render, y = (u = T.contextType) && r[u.__c], b = u ? y ? y.props.value : u.__ : r, n.__c ? g = (d = t.__c = n.__c).__ = d.__E : (v ? t.__c = d = new T(_, b) : (t.__c = d = new me(_, b), d.constructor = T, d.render = Pe), y && y.sub(d), d.state ||= {}, d.__n = r, f = d.__d = !0, d.__h = [], d._sb = []), v && d.__s == null && (d.__s = d.state), v && T.getDerivedStateFromProps != null && (d.__s == d.state && (d.__s = le({}, d.__s)), le(d.__s, T.getDerivedStateFromProps(_, d.__s))), p = d.props, m = d.state, d.__v = t, f) v && T.getDerivedStateFromProps == null && d.componentWillMount != null && d.componentWillMount(), v && d.componentDidMount != null && d.__h.push(d.componentDidMount);
		else {
			if (v && T.getDerivedStateFromProps == null && _ !== p && d.componentWillReceiveProps != null && d.componentWillReceiveProps(_, b), t.__v == n.__v || !d.__e && d.shouldComponentUpdate != null && !1 === d.shouldComponentUpdate(_, d.__s, b)) {
				t.__v != n.__v && (d.props = _, d.state = d.__s, d.__d = !1), t.__e = n.__e, t.__k = n.__k, t.__k.some(function(e) {
					e && (e.__ = t);
				}), Ze.push.apply(d.__h, d._sb), d._sb = [], d.__h.length && o.push(d);
				break n;
			}
			d.componentWillUpdate != null && d.componentWillUpdate(_, d.__s, b), v && d.componentDidUpdate != null && d.__h.push(function() {
				d.componentDidUpdate(p, m, h);
			});
		}
		if (d.context = b, d.props = _, d.__P = e, d.__e = !1, x = J.__r, S = 0, v) d.state = d.__s, d.__d = !1, x && x(t), u = d.render(d.props, d.state, d.context), Ze.push.apply(d.__h, d._sb), d._sb = [];
		else do
			d.__d = !1, x && x(t), u = d.render(d.props, d.state, d.context), d.state = d.__s;
		while (d.__d && ++S < 25);
		d.state = d.__s, d.getChildContext != null && (r = le(le({}, r), d.getChildContext())), v && !f && d.getSnapshotBeforeUpdate != null && (h = d.getSnapshotBeforeUpdate(p, m)), C = u != null && u.type === pe && u.key == null ? Ae(u.props.children) : u, s = be(e, $e(C) ? C : [C], t, n, r, i, a, o, s, c, l), d.base = t.__e, t.__u &= -161, d.__h.length && o.push(d), g && (d.__E = d.__ = null);
	} catch (e) {
		if (t.__v = null, c || a != null) if (e.then) {
			for (t.__u |= c ? 160 : 128; s && s.nodeType == 8 && s.nextSibling;) s = s.nextSibling;
			a[a.indexOf(s)] = null, t.__e = s;
		} else {
			for (w = a.length; w--;) ue(a[w]);
			Oe(t);
		}
		else t.__e = n.__e, t.__k = n.__k, e.then || Oe(t);
		J.__e(e, t, n);
	}
	else a == null && t.__v == n.__v ? (t.__k = n.__k, t.__e = n.__e) : s = t.__e = je(n.__e, t, n, r, i, a, o, c, l);
	return (u = J.diffed) && u(t), 128 & t.__u ? void 0 : s;
}
function Oe(e) {
	e && (e.__c && (e.__c.__e = !0), e.__k && e.__k.some(Oe));
}
function ke(e, t, n) {
	for (var r = 0; r < n.length; r++) Me(n[r], n[++r], n[++r]);
	J.__c && J.__c(t, e), e.some(function(t) {
		try {
			e = t.__h, t.__h = [], e.some(function(e) {
				e.call(t);
			});
		} catch (e) {
			J.__e(e, t.__v);
		}
	});
}
function Ae(e) {
	return typeof e != "object" || !e || e.__b > 0 ? e : $e(e) ? e.map(Ae) : e.constructor === void 0 ? le({}, e) : null;
}
function je(e, t, n, r, i, a, o, s, c) {
	var l, u, d, f, p, m, h, g = n.props || Xe, _ = t.props, v = t.type;
	if (v == "svg" ? i = "http://www.w3.org/2000/svg" : v == "math" ? i = "http://www.w3.org/1998/Math/MathML" : i ||= "http://www.w3.org/1999/xhtml", a != null) {
		for (l = 0; l < a.length; l++) if ((p = a[l]) && "setAttribute" in p == !!v && (v ? p.localName == v : p.nodeType == 3)) {
			e = p, a[l] = null;
			break;
		}
	}
	if (e == null) {
		if (v == null) return document.createTextNode(_);
		e = document.createElementNS(i, v, _.is && _), s &&= (J.__m && J.__m(t, a), !1), a = null;
	}
	if (v == null) g === _ || s && e.data == _ || (e.data = _);
	else {
		if (a = v == "textarea" && _.defaultValue != null ? null : a && Ie.call(e.childNodes), !s && a != null) for (g = {}, l = 0; l < e.attributes.length; l++) g[(p = e.attributes[l]).name] = p.value;
		for (l in g) p = g[l], l == "dangerouslySetInnerHTML" ? d = p : l == "children" || l in _ || l == "value" && "defaultValue" in _ || l == "checked" && "defaultChecked" in _ || Te(e, l, null, p, i);
		for (l in _) p = _[l], l == "children" ? f = p : l == "dangerouslySetInnerHTML" ? u = p : l == "value" ? m = p : l == "checked" ? h = p : s && typeof p != "function" || g[l] === p || Te(e, l, p, g[l], i);
		if (u) s || d && (u.__html == d.__html || u.__html == e.innerHTML) || (e.innerHTML = u.__html), t.__k = [];
		else if (d && (e.innerHTML = ""), be(t.type == "template" ? e.content : e, $e(f) ? f : [f], t, n, r, v == "foreignObject" ? "http://www.w3.org/1999/xhtml" : i, a, o, a ? a[0] : n.__k && he(n, 0), s, c), a != null) for (l = a.length; l--;) ue(a[l]);
		s && v != "textarea" || (l = "value", v == "progress" && m == null ? e.removeAttribute("value") : m != null && (m !== e[l] || v == "progress" && !m || v == "option" && m != g[l]) && Te(e, l, m, g[l], i), l = "checked", h != null && h != e[l] && Te(e, l, h, g[l], i));
	}
	return e;
}
function Me(e, t, n) {
	try {
		if (typeof e == "function") {
			var r = typeof e.__u == "function";
			r && e.__u(), r && t == null || (e.__u = e(t));
		} else e.current = t;
	} catch (e) {
		J.__e(e, n);
	}
}
function Ne(e, t, n) {
	var r, i;
	if (J.unmount && J.unmount(e), (r = e.ref) && (r.current && r.current != e.__e || Me(r, null, t)), (r = e.__c) != null) {
		if (r.componentWillUnmount) try {
			r.componentWillUnmount();
		} catch (e) {
			J.__e(e, t);
		}
		r.base = r.__P = null;
	}
	if (r = e.__k) for (i = 0; i < r.length; i++) r[i] && Ne(r[i], t, n || typeof e.type != "function");
	n || ue(e.__e), e.__c = e.__ = e.__e = void 0;
}
function Pe(e, t, n) {
	return this.constructor(e, n);
}
function Fe(e, t, n) {
	var r, i, a, o;
	t == document && (t = document.documentElement), J.__ && J.__(e, t), i = (r = typeof n == "function") ? null : n && n.__k || t.__k, a = [], o = [], De(t, e = (!r && n || t).__k = de(pe, null, [e]), i || Xe, Xe, t.namespaceURI, !r && n ? [n] : i ? null : t.firstChild ? Ie.call(t.childNodes) : null, a, !r && n ? n : i ? i.__e : t.firstChild, r, o), ke(a, e, o);
}
var Ie, J, Le, Re, ze, Be, Ve, He, Ue, We, Ge, Ke, qe, Je, Ye, Xe, Ze, Qe, $e, et = t((() => {
	Xe = {}, Ze = [], Qe = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i, $e = Array.isArray, Ie = Ze.slice, J = { __e: function(e, t, n, r) {
		for (var i, a, o; t = t.__;) if ((i = t.__c) && !i.__) try {
			if ((a = i.constructor) && a.getDerivedStateFromError != null && (i.setState(a.getDerivedStateFromError(e)), o = i.__d), i.componentDidCatch != null && (i.componentDidCatch(e, r || {}), o = i.__d), o) return i.__E = i;
		} catch (t) {
			e = t;
		}
		throw e;
	} }, Le = 0, Re = function(e) {
		return e != null && e.constructor === void 0;
	}, me.prototype.setState = function(e, t) {
		var n = this.__s != null && this.__s != this.state ? this.__s : this.__s = le({}, this.state);
		typeof e == "function" && (e = e(le({}, n), this.props)), e && le(n, e), e != null && this.__v && (t && this._sb.push(t), ve(this));
	}, me.prototype.forceUpdate = function(e) {
		this.__v && (this.__e = !0, e && this.__h.push(e), ve(this));
	}, me.prototype.render = pe, ze = [], Ve = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, He = function(e, t) {
		return e.__v.__b - t.__v.__b;
	}, ye.__r = 0, Ue = Math.random().toString(8), We = "__d" + Ue, Ge = "__a" + Ue, Ke = /(PointerCapture)$|Capture$/i, qe = 0, Je = Ee(!1), Ye = Ee(!0);
}));
//#endregion
//#region ../../node_modules/.pnpm/preact@10.29.2/node_modules/preact/hooks/dist/hooks.module.js
function tt(e, t) {
	vt.__h && vt.__h(pt, e, gt || t), gt = 0;
	var n = pt.__H ||= {
		__: [],
		__h: []
	};
	return e >= n.__.length && n.__.push({}), n.__[e];
}
function nt(e) {
	return gt = 1, rt(dt, e);
}
function rt(e, t, n) {
	var r = tt(ft++, 2);
	if (r.t = e, !r.__c && (r.__ = [n ? n(t) : dt(void 0, t), function(e) {
		var t = r.__N ? r.__N[0] : r.__[0], n = r.t(t, e);
		t !== n && (r.__N = [n, r.__[1]], r.__c.setState({}));
	}], r.__c = pt, !pt.__f)) {
		var i = function(e, t, n) {
			if (!r.__c.__H) return !0;
			var i = r.__c.__H.__.filter(function(e) {
				return e.__c;
			});
			if (i.every(function(e) {
				return !e.__N;
			})) return !a || a.call(this, e, t, n);
			var o = r.__c.props !== e;
			return i.some(function(e) {
				if (e.__N) {
					var t = e.__[0];
					e.__ = e.__N, e.__N = void 0, t !== e.__[0] && (o = !0);
				}
			}), a && a.call(this, e, t, n) || o;
		};
		pt.__f = !0;
		var a = pt.shouldComponentUpdate, o = pt.componentWillUpdate;
		pt.componentWillUpdate = function(e, t, n) {
			if (this.__e) {
				var r = a;
				a = void 0, i(e, t, n), a = r;
			}
			o && o.call(this, e, t, n);
		}, pt.shouldComponentUpdate = i;
	}
	return r.__N || r.__;
}
function it(e, t) {
	var n = tt(ft++, 3);
	!vt.__s && ut(n.__H, t) && (n.__ = e, n.u = t, pt.__H.__h.push(n));
}
function at(e, t) {
	var n = tt(ft++, 7);
	return ut(n.__H, t) && (n.__ = e(), n.__H = t, n.__h = e), n.__;
}
function ot() {
	for (var e; e = _t.shift();) {
		var t = e.__H;
		if (e.__P && t) try {
			t.__h.some(ct), t.__h.some(lt), t.__h = [];
		} catch (n) {
			t.__h = [], vt.__e(n, e.__v);
		}
	}
}
function st(e) {
	var t, n = function() {
		clearTimeout(r), Tt && cancelAnimationFrame(t), setTimeout(e);
	}, r = setTimeout(n, 35);
	Tt && (t = requestAnimationFrame(n));
}
function ct(e) {
	var t = pt, n = e.__c;
	typeof n == "function" && (e.__c = void 0, n()), pt = t;
}
function lt(e) {
	var t = pt;
	e.__c = e.__(), pt = t;
}
function ut(e, t) {
	return !e || e.length !== t.length || t.some(function(t, n) {
		return t !== e[n];
	});
}
function dt(e, t) {
	return typeof t == "function" ? t(e) : t;
}
var ft, pt, mt, ht, gt, _t, vt, yt, bt, xt, St, Ct, wt, Tt, Et = t((() => {
	et(), gt = 0, _t = [], vt = J, yt = vt.__b, bt = vt.__r, xt = vt.diffed, St = vt.__c, Ct = vt.unmount, wt = vt.__, vt.__b = function(e) {
		pt = null, yt && yt(e);
	}, vt.__ = function(e, t) {
		e && t.__k && t.__k.__m && (e.__m = t.__k.__m), wt && wt(e, t);
	}, vt.__r = function(e) {
		bt && bt(e), ft = 0;
		var t = (pt = e.__c).__H;
		t && (mt === pt ? (t.__h = [], pt.__h = [], t.__.some(function(e) {
			e.__N && (e.__ = e.__N), e.u = e.__N = void 0;
		})) : (t.__h.some(ct), t.__h.some(lt), t.__h = [], ft = 0)), mt = pt;
	}, vt.diffed = function(e) {
		xt && xt(e);
		var t = e.__c;
		t && t.__H && (t.__H.__h.length && (_t.push(t) !== 1 && ht === vt.requestAnimationFrame || ((ht = vt.requestAnimationFrame) || st)(ot)), t.__H.__.some(function(e) {
			e.u && (e.__H = e.u), e.u = void 0;
		})), mt = pt = null;
	}, vt.__c = function(e, t) {
		t.some(function(e) {
			try {
				e.__h.some(ct), e.__h = e.__h.filter(function(e) {
					return !e.__ || lt(e);
				});
			} catch (n) {
				t.some(function(e) {
					e.__h &&= [];
				}), t = [], vt.__e(n, e.__v);
			}
		}), St && St(e, t);
	}, vt.unmount = function(e) {
		Ct && Ct(e);
		var t, n = e.__c;
		n && n.__H && (n.__H.__.some(function(e) {
			try {
				ct(e);
			} catch (e) {
				t = e;
			}
		}), n.__H = void 0, t && vt.__e(t, n.__v));
	}, Tt = typeof requestAnimationFrame == "function";
}));
//#endregion
//#region ../../node_modules/.pnpm/@preact+signals-core@1.14.2/node_modules/@preact/signals-core/dist/signals-core.module.js
function Dt() {
	if (qt > 1) qt--;
	else {
		var e, t = !1;
		for ((function() {
			var e = Zt;
			for (Zt = void 0; e !== void 0;) e.S.v === e.v && (e.S.i = e.i), e = e.o;
		})(); Kt !== void 0;) {
			var n = Kt;
			for (Kt = void 0, Jt++; n !== void 0;) {
				var r = n.u;
				if (n.u = void 0, n.f &= -3, !(8 & n.f) && Nt(n)) try {
					n.c();
				} catch (n) {
					t ||= (e = n, !0);
				}
				n = r;
			}
		}
		if (Jt = 0, qt--, t) throw e;
	}
}
function Ot(e) {
	if (qt > 0) return e();
	Xt = ++Yt, qt++;
	try {
		return e();
	} finally {
		Dt();
	}
}
function kt(e) {
	var t = Wt;
	Wt = void 0;
	try {
		return e();
	} finally {
		Wt = t;
	}
}
function At(e) {
	if (Wt !== void 0) {
		var t = e.n;
		if (t === void 0 || t.t !== Wt) return t = {
			i: 0,
			S: e,
			p: Wt.s,
			n: void 0,
			t: Wt,
			e: void 0,
			x: void 0,
			r: t
		}, Wt.s !== void 0 && (Wt.s.n = t), Wt.s = t, e.n = t, 32 & Wt.f && e.S(t), t;
		if (t.i === -1) return t.i = 0, t.n !== void 0 && (t.n.p = t.p, t.p !== void 0 && (t.p.n = t.n), t.p = Wt.s, t.n = void 0, Wt.s.n = t, Wt.s = t), t;
	}
}
function jt(e, t) {
	this.v = e, this.i = 0, this.n = void 0, this.t = void 0, this.l = 0, this.W = t?.watched, this.Z = t?.unwatched, this.name = t?.name;
}
function Mt(e, t) {
	return new jt(e, t);
}
function Nt(e) {
	for (var t = e.s; t !== void 0; t = t.n) if (t.S.i !== t.i || !t.S.h() || t.S.i !== t.i) return !0;
	return !1;
}
function Pt(e) {
	for (var t = e.s; t !== void 0; t = t.n) {
		var n = t.S.n;
		if (n !== void 0 && (t.r = n), t.S.n = t, t.i = -1, t.n === void 0) {
			e.s = t;
			break;
		}
	}
}
function Ft(e) {
	for (var t = e.s, n = void 0; t !== void 0;) {
		var r = t.p;
		t.i === -1 ? (t.S.U(t), r !== void 0 && (r.n = t.n), t.n !== void 0 && (t.n.p = r)) : n = t, t.S.n = t.r, t.r !== void 0 && (t.r = void 0), t = r;
	}
	e.s = n;
}
function It(e, t) {
	jt.call(this, void 0), this.x = e, this.s = void 0, this.g = Qt - 1, this.f = 4, this.W = t?.watched, this.Z = t?.unwatched, this.name = t?.name;
}
function Lt(e, t) {
	return new It(e, t);
}
function Rt(e) {
	var t = e.m;
	if (e.m = void 0, typeof t == "function") {
		qt++;
		var n = Wt;
		Wt = void 0;
		try {
			t();
		} catch (t) {
			throw e.f &= -2, e.f |= 8, zt(e), t;
		} finally {
			Wt = n, Dt();
		}
	}
}
function zt(e) {
	for (var t = e.s; t !== void 0; t = t.n) t.S.U(t);
	e.x = void 0, e.s = void 0, Rt(e);
}
function Bt(e) {
	if (Wt !== this) throw Error("Out-of-order effect");
	Ft(this), Wt = e, this.f &= -2, 8 & this.f && zt(this), Dt();
}
function Vt(e, t) {
	this.x = e, this.m = void 0, this.s = void 0, this.u = void 0, this.f = 32, this.name = t?.name, Gt && Gt.push(this);
}
function Ht(e, t) {
	var n = new Vt(e, t);
	try {
		n.c();
	} catch (e) {
		throw n.d(), e;
	}
	var r = n.d.bind(n);
	return r[Symbol.dispose] = r, r;
}
var Ut, Wt, Gt, Kt, qt, Jt, Yt, Xt, Zt, Qt, $t = t((() => {
	Ut = Symbol.for("preact-signals"), Wt = void 0, Kt = void 0, qt = 0, Jt = 0, Yt = 0, Xt = 0, Zt = void 0, Qt = 0, jt.prototype.brand = Ut, jt.prototype.h = function() {
		return !0;
	}, jt.prototype.S = function(e) {
		var t = this, n = this.t;
		n !== e && e.e === void 0 && (e.x = n, this.t = e, n === void 0 ? kt(function() {
			var e;
			(e = t.W) == null || e.call(t);
		}) : n.e = e);
	}, jt.prototype.U = function(e) {
		var t = this;
		if (this.t !== void 0) {
			var n = e.e, r = e.x;
			n !== void 0 && (n.x = r, e.e = void 0), r !== void 0 && (r.e = n, e.x = void 0), e === this.t && (this.t = r, r === void 0 && kt(function() {
				var e;
				(e = t.Z) == null || e.call(t);
			}));
		}
	}, jt.prototype.subscribe = function(e) {
		var t = this;
		return Ht(function() {
			var n = t.value, r = Wt;
			Wt = void 0;
			try {
				e(n);
			} finally {
				Wt = r;
			}
		}, { name: "sub" });
	}, jt.prototype.valueOf = function() {
		return this.value;
	}, jt.prototype.toString = function() {
		return this.value + "";
	}, jt.prototype.toJSON = function() {
		return this.value;
	}, jt.prototype.peek = function() {
		var e = this;
		return kt(function() {
			return e.value;
		});
	}, Object.defineProperty(jt.prototype, "value", {
		get: function() {
			var e = At(this);
			return e !== void 0 && (e.i = this.i), this.v;
		},
		set: function(e) {
			if (e !== this.v) {
				if (Jt > 100) throw Error("Cycle detected");
				(function(e) {
					qt !== 0 && Jt === 0 && e.l !== Xt && (e.l = Xt, Zt = {
						S: e,
						v: e.v,
						i: e.i,
						o: Zt
					});
				})(this), this.v = e, this.i++, Qt++, qt++;
				try {
					for (var t = this.t; t !== void 0; t = t.x) t.t.N();
				} finally {
					Dt();
				}
			}
		}
	}), It.prototype = new jt(), It.prototype.h = function() {
		if (this.f &= -3, 1 & this.f) return !1;
		if ((36 & this.f) == 32 || (this.f &= -5, this.g === Qt)) return !0;
		if (this.g = Qt, this.f |= 1, this.i > 0 && !Nt(this)) return this.f &= -2, !0;
		var e = Wt;
		try {
			Pt(this), Wt = this;
			var t = this.x();
			(16 & this.f || this.v !== t || this.i === 0) && (this.v = t, this.f &= -17, this.i++);
		} catch (e) {
			this.v = e, this.f |= 16, this.i++;
		}
		return Wt = e, Ft(this), this.f &= -2, !0;
	}, It.prototype.S = function(e) {
		if (this.t === void 0) {
			this.f |= 36;
			for (var t = this.s; t !== void 0; t = t.n) t.S.S(t);
		}
		jt.prototype.S.call(this, e);
	}, It.prototype.U = function(e) {
		if (this.t !== void 0 && (jt.prototype.U.call(this, e), this.t === void 0)) {
			this.f &= -33;
			for (var t = this.s; t !== void 0; t = t.n) t.S.U(t);
		}
	}, It.prototype.N = function() {
		if (!(2 & this.f)) {
			this.f |= 6;
			for (var e = this.t; e !== void 0; e = e.x) e.t.N();
		}
	}, Object.defineProperty(It.prototype, "value", { get: function() {
		if (1 & this.f) throw Error("Cycle detected");
		var e = At(this);
		if (this.h(), e !== void 0 && (e.i = this.i), 16 & this.f) throw this.v;
		return this.v;
	} }), Vt.prototype.c = function() {
		var e = this.S();
		try {
			if (8 & this.f || this.x === void 0) return;
			var t = this.x();
			typeof t == "function" && (this.m = t);
		} finally {
			e();
		}
	}, Vt.prototype.S = function() {
		if (1 & this.f) throw Error("Cycle detected");
		this.f |= 1, this.f &= -9, Rt(this), Pt(this), qt++;
		var e = Wt;
		return Wt = this, Bt.bind(this, e);
	}, Vt.prototype.N = function() {
		2 & this.f || (this.f |= 2, this.u = Kt, Kt = this);
	}, Vt.prototype.d = function() {
		this.f |= 8, 1 & this.f || zt(this);
	}, Vt.prototype.dispose = function() {
		this.d();
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@preact+signals@2.9.0_preact@10.29.2/node_modules/@preact/signals/dist/signals.module.js
function en(e, t) {
	J[e] = t.bind(null, J[e] || function() {});
}
function tn(e) {
	if (ln) {
		var t = ln;
		ln = void 0, t();
	}
	ln = e && e.S();
}
function nn(e) {
	var t = this, n = e.data, r = an(n);
	r.value = n;
	var i = at(function() {
		for (var e = t, n = t.__v; n = n.__;) if (n.__c) {
			n.__c.__$f |= 4;
			break;
		}
		var i = Lt(function() {
			var e = r.value.value;
			return e === 0 ? 0 : !0 === e ? "" : e || "";
		}), a = Lt(function() {
			return !Array.isArray(i.value) && !Re(i.value);
		}), o = Ht(function() {
			if (this.N = sn, a.value) {
				var t = i.value;
				e.__v && e.__v.__e && e.__v.__e.nodeType === 3 && (e.__v.__e.data = t);
			}
		}), s = t.__$u.d;
		return t.__$u.d = function() {
			o(), s.call(this);
		}, [a, i];
	}, []), a = i[0], o = i[1];
	return a.value ? o.peek() : o.value;
}
function rn(e, t, n, r) {
	var i = t in e && e.ownerSVGElement === void 0, a = Mt(n), o = n.peek();
	return {
		o: function(e, t) {
			a.value = e, o = e.peek();
		},
		d: Ht(function() {
			this.N = sn;
			var n = a.value.value;
			o === n ? o = void 0 : (o = void 0, i ? e[t] = n : n != null && (!1 !== n || t[4] === "-") ? e.setAttribute(t, n) : e.removeAttribute(t));
		})
	};
}
function an(e, t) {
	return at(function() {
		return Mt(e, t);
	}, []);
}
function on() {
	Ot(function() {
		for (var e; e = dn.shift();) cn.call(e);
	});
}
function sn() {
	dn.push(this) === 1 && (J.requestAnimationFrame || fn)(on);
}
var cn, ln, un, dn, fn, pn = t((() => {
	et(), Et(), $t(), un = typeof window < "u" && !!window.__PREACT_SIGNALS_DEVTOOLS__, dn = [], Ht(function() {
		cn = this.N;
	})(), nn.displayName = "ReactiveTextNode", Object.defineProperties(jt.prototype, {
		constructor: {
			configurable: !0,
			value: void 0
		},
		type: {
			configurable: !0,
			value: nn
		},
		props: {
			configurable: !0,
			get: function() {
				var e = this;
				return { data: { get value() {
					return e.value;
				} } };
			}
		},
		__b: {
			configurable: !0,
			value: 1
		}
	}), en("__b", function(e, t) {
		if (typeof t.type == "string") {
			var n, r = t.props;
			for (var i in r) if (i !== "children") {
				var a = r[i];
				a instanceof jt && (n || (t.__np = n = {}), n[i] = a, r[i] = a.peek());
			}
		}
		e(t);
	}), en("__r", function(e, t) {
		if (e(t), t.type !== pe) {
			tn();
			var n, r = t.__c;
			r && (r.__$f &= -2, (n = r.__$u) === void 0 && (r.__$u = n = function(e, t) {
				var n;
				return Ht(function() {
					n = this;
				}, { name: t }), n.c = e, n;
			}(function() {
				var e;
				un && ((e = n.y) == null || e.call(n)), r.__$f |= 1, r.setState({});
			}, typeof t.type == "function" ? t.type.displayName || t.type.name : ""))), tn(n);
		}
	}), en("__e", function(e, t, n, r) {
		tn(), e(t, n, r);
	}), en("diffed", function(e, t) {
		tn();
		var n;
		if (typeof t.type == "string" && (n = t.__e)) {
			var r = t.__np, i = t.props;
			if (r) {
				var a = n.U;
				if (a) for (var o in a) {
					var s = a[o];
					s !== void 0 && !(o in r) && (s.d(), a[o] = void 0);
				}
				else a = {}, n.U = a;
				for (var c in r) {
					var l = a[c], u = r[c];
					l === void 0 ? (l = rn(n, c, u), a[c] = l) : l.o(u, i);
				}
				for (var d in r) i[d] = r[d];
			}
		}
		e(t);
	}), en("unmount", function(e, t) {
		if (typeof t.type == "string") {
			var n = t.__e;
			if (n) {
				var r = n.U;
				if (r) for (var i in n.U = void 0, r) {
					var a = r[i];
					a && a.d();
				}
			}
			t.__np = void 0;
		} else {
			var o = t.__c;
			if (o) {
				var s = o.__$u;
				s && (o.__$u = void 0, s.d());
			}
		}
		e(t);
	}), en("__h", function(e, t, n, r) {
		(r < 3 || r === 9) && (t.__$f |= 2), e(t, n, r);
	}), me.prototype.shouldComponentUpdate = function(e, t) {
		if (this.__R) return !0;
		var n = this.__$u, r = n && n.s !== void 0;
		for (var i in t) return !0;
		if (this.__f || typeof this.u == "boolean" && !0 === this.u) {
			var a = 2 & this.__$f;
			if (!(r || a || 4 & this.__$f) || 1 & this.__$f) return !0;
		} else if (!(r || 4 & this.__$f) || 3 & this.__$f) return !0;
		for (var o in e) if (o !== "__source" && e[o] !== this.props[o]) return !0;
		for (var s in this.props) if (!(s in e)) return !0;
		return !1;
	}, fn = function(e) {
		queueMicrotask(function() {
			queueMicrotask(e);
		});
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/htm@3.1.1/node_modules/htm/dist/htm.module.js
function mn(e) {
	var t = gn.get(this);
	return t || (t = /* @__PURE__ */ new Map(), gn.set(this, t)), (t = hn(this, t.get(e) || (t.set(e, t = function(e) {
		for (var t, n, r = 1, i = "", a = "", o = [0], s = function(e) {
			r === 1 && (e || (i = i.replace(/^\s*\n\s*|\s*\n\s*$/g, ""))) ? o.push(0, e, i) : r === 3 && (e || i) ? (o.push(3, e, i), r = 2) : r === 2 && i === "..." && e ? o.push(4, e, 0) : r === 2 && i && !e ? o.push(5, 0, !0, i) : r >= 5 && ((i || !e && r === 5) && (o.push(r, 0, i, n), r = 6), e && (o.push(r, e, 0, n), r = 6)), i = "";
		}, c = 0; c < e.length; c++) {
			c && (r === 1 && s(), s(c));
			for (var l = 0; l < e[c].length; l++) t = e[c][l], r === 1 ? t === "<" ? (s(), o = [o], r = 3) : i += t : r === 4 ? i === "--" && t === ">" ? (r = 1, i = "") : i = t + i[0] : a ? t === a ? a = "" : i += t : t === "\"" || t === "'" ? a = t : t === ">" ? (s(), r = 1) : r && (t === "=" ? (r = 5, n = i, i = "") : t === "/" && (r < 5 || e[c][l + 1] === ">") ? (s(), r === 3 && (o = o[0]), r = o, (o = o[0]).push(2, 0, r), r = 0) : t === " " || t === "	" || t === "\n" || t === "\r" ? (s(), r = 2) : i += t), r === 3 && i === "!--" && (r = 4, o = o[0]);
		}
		return s(), o;
	}(e)), t), arguments, [])).length > 1 ? t : t[0];
}
var hn, gn, _n = t((() => {
	hn = function(e, t, n, r) {
		var i;
		t[0] = 0;
		for (var a = 1; a < t.length; a++) {
			var o = t[a++], s = t[a] ? (t[0] |= o ? 1 : 2, n[t[a++]]) : t[++a];
			o === 3 ? r[0] = s : o === 4 ? r[1] = Object.assign(r[1] || {}, s) : o === 5 ? (r[1] = r[1] || {})[t[++a]] = s : o === 6 ? r[1][t[++a]] += s + "" : o ? (i = e.apply(s, hn(e, s, n, ["", null])), r.push(i), s[0] ? t[0] |= 2 : (t[a - 2] = 0, t[a] = i)) : r.push(s);
		}
		return r;
	}, gn = /* @__PURE__ */ new Map();
})), vn, yn = t((() => {
	et(), _n(), vn = mn.bind(de);
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/state/values.js
function bn() {
	jn.value = [], Rn.value = [], Vn.value = [], Mn.value = void 0, Nn.value = void 0;
}
var xn, Sn, Cn, wn, Tn, En, Dn, On, kn, An, jn, Mn, Nn, Pn, Fn, In, Ln, Rn, zn, Bn, Vn, Hn = t((() => {
	pn(), q(), xn = globalThis.localStorage, Sn = Mt(B.FIXED), Cn = Mt("Connect a Wallet"), wn = Mt(!0), Tn = Mt(!0), En = Mt("Install"), Dn = Mt("https://horizon.stellar.org"), On = Mt(G.PUBLIC), kn = Mt(V), An = Mt(z.AUTH_OPTIONS), jn = Mt([z.AUTH_OPTIONS]), Mn = Mt(xn?.getItem(W.activeAddress) || void 0), Nn = Mt(xn?.getItem(W.selectedModuleId) || void 0), Pn = Mt([]), Fn = Mt([]), In = Lt(() => Fn.value.find((e) => e.productId === Nn.value)), Ln = xn?.getItem(W.hardwareWalletPaths), Rn = Mt(JSON.parse(Ln || "[]")), zn = Lt(() => {
		let e = Rn.value.find(({ publicKey: e }) => e === Mn.value);
		if (e) return `44'/148'/${e.index}'`;
	}), Bn = xn?.getItem(W.wcSessionPaths), Vn = Mt(JSON.parse(Bn || "[]"));
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/state/events.js
function Un() {
	let e = Mt(null), t = "active", n = null, r = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Set();
	Ht(() => {
		if (t === "active" && e.value !== null) {
			let t = e.value;
			e.value = null;
			for (let e of r) e(t);
		}
	});
	function o() {
		r.clear(), i.clear(), a.clear();
	}
	return {
		next(n) {
			t === "active" && (e.value = n);
		},
		error(e) {
			if (t === "active") {
				t = "error", n = e;
				for (let t of i) t(e);
				o();
			}
		},
		complete() {
			if (t === "active") {
				t = "completed";
				for (let e of a) e();
				o();
			}
		},
		subscribe(e, o, s) {
			return t === "error" ? (o?.(n), () => {}) : t === "completed" ? (s?.(), () => {}) : (e && r.add(e), o && i.add(o), s && a.add(s), () => {
				e && r.delete(e), o && i.delete(o), s && a.delete(s);
			});
		},
		isCompleted() {
			return t === "completed";
		},
		hasError() {
			return t === "error";
		}
	};
}
var Wn, Gn, Kn, qn, Jn = t((() => {
	pn(), Wn = Un(), Gn = Un(), Kn = Un(), qn = Un();
})), Yn, Xn, Zn, Qn, $n, er = t((() => {
	pn(), Hn(), q(), Yn = globalThis.localStorage, Xn = globalThis.document, Zn = Ht(() => {
		if (Xn) for (let [e, t] of Object.entries(kn.value)) Xn.documentElement.style.setProperty(`--swk-${e}`, t);
	}), Qn = Ht(() => {
		if (Yn && In.value) try {
			let e = Yn.getItem(W.usedWalletsIds), t = e ? new Set(JSON.parse(e)) : /* @__PURE__ */ new Set();
			t.has(In.value.productId) && t.delete(In.value.productId), Yn.setItem(W.usedWalletsIds, JSON.stringify([In.value.productId, ...t]));
		} catch (e) {
			console.error(e);
		}
	}), $n = Ht(() => {
		Yn && (Mn.value ? Yn.setItem(W.activeAddress, Mn.value) : Yn.removeItem(W.activeAddress), Nn.value ? Yn.setItem(W.selectedModuleId, Nn.value) : Yn.removeItem(W.selectedModuleId), Rn.value !== void 0 && Yn.setItem(W.hardwareWalletPaths, JSON.stringify(Rn.value)), Vn.value !== void 0 && Yn.setItem(W.wcSessionPaths, JSON.stringify(Vn.value)));
	});
})), tr = t((() => {
	Hn(), Jn(), er();
}));
//#endregion
//#region ../../node_modules/.pnpm/@twind+core@1.1.3_typescript@5.9.2/node_modules/@twind/core/core.js
function nr(e) {
	return [...e.v, (e.i ? "!" : "") + e.n].join(":");
}
function rr(e, t = ",") {
	return e.map(nr).join(t);
}
function ir(e) {
	for (var t = 9, n = e.length; n--;) t = Math.imul(t ^ e.charCodeAt(n), 1597334677);
	return "#" + ((t ^ t >>> 9) >>> 0).toString(36);
}
function ar(e, t = "@media ") {
	return t + or(e).map((e) => (typeof e == "string" && (e = { min: e }), e.raw || Object.keys(e).map((t) => `(${t}-width:${e[t]})`).join(" and "))).join(",");
}
function or(e = []) {
	return Array.isArray(e) ? e : e == null ? [] : [e];
}
function sr(e) {
	return e;
}
function cr() {}
function lr(e) {
	return e.match(/[-=:;]/g)?.length || 0;
}
function ur(e) {
	return Math.min(/(?:^|width[^\d]+)(\d+(?:.\d+)?)(p)?/.test(e) ? Math.max(0, 29.63 * (RegExp.$1 / (RegExp.$2 ? 15 : 1)) ** .137 - 43) : 0, 15) << 22 | Math.min(lr(e), 15) << 18;
}
function dr({ n: e, i: t, v: n = [] }, r, i, a) {
	e &&= nr({
		n: e,
		i: t,
		v: n
	}), a = [...or(a)];
	for (let e of n) {
		let t = r.theme("screens", e);
		for (let n of or(t && ar(t) || r.v(e))) {
			var o;
			a.push(n), i |= t ? 67108864 | ur(n) : e == "dark" ? 1073741824 : n[0] == "@" ? ur(n) : (o = n, 1 << ~(/:([a-z-]+)/.test(o) && ~ci.indexOf(RegExp.$1.slice(2, 7)) || -18));
		}
	}
	return {
		n: e,
		p: i,
		r: a,
		i: t
	};
}
function fr(e) {
	if (e.d) {
		let t = [], n = pr(e.r.reduce((e, n) => n[0] == "@" ? (t.push(n), e) : n ? pr(e, (e) => pr(n, (t) => {
			let n = /(:merge\(.+?\))(:[a-z-]+|\\[.+])/.exec(t);
			if (n) {
				let r = e.indexOf(n[1]);
				return ~r ? e.slice(0, r) + n[0] + e.slice(r + n[1].length) : mr(e, t);
			}
			return mr(t, e);
		})) : e, "&"), (t) => mr(t, e.n ? "." + oi(e.n) : ""));
		return n && t.push(n.replace(/:merge\((.+?)\)/g, "$1")), t.reduceRight((e, t) => t + "{" + e + "}", e.d);
	}
}
function pr(e, t) {
	return e.replace(/ *((?:\(.+?\)|\[.+?\]|[^,])+) *(,|$)/g, (e, n, r) => t(n) + r);
}
function mr(e, t) {
	return e.replace(/&/g, t);
}
function hr(e, t) {
	for (var n = 0, r = e.length; n < r;) {
		let i = r + n >> 1;
		0 >= gr(e[i], t) ? n = i + 1 : r = i;
	}
	return r;
}
function gr(e, t) {
	let n = e.p & si.o;
	return n == (t.p & si.o) && (n == si.b || n == si.o) ? 0 : e.p - t.p || e.o - t.o || ui.compare(_r(e.n), _r(t.n)) || ui.compare(vr(e.n), vr(t.n));
}
function _r(e) {
	return (e || "").split(/:/).pop().split("/").pop() || "\0";
}
function vr(e) {
	return (e || "").replace(/\W/g, (e) => String.fromCharCode(127 + e.charCodeAt(0))) + "\0";
}
function yr(e, t) {
	return Math.round(parseInt(e, 16) * t);
}
function br(e, t = {}) {
	if (typeof e == "function") return e(t);
	let { opacityValue: n = "1", opacityVariable: r } = t, i = r ? `var(${r})` : n;
	if (e.includes("<alpha-value>")) return e.replace("<alpha-value>", i);
	if (e[0] == "#" && (e.length == 4 || e.length == 7)) {
		let t = (e.length - 1) / 3, n = [
			17,
			1,
			.062272
		][t - 1];
		return `rgba(${[
			yr(e.substr(1, t), n),
			yr(e.substr(1 + t, t), n),
			yr(e.substr(1 + 2 * t, t), n),
			i
		]})`;
	}
	return i == "1" ? e : i == "0" ? "#0000" : e.replace(/^(rgb|hsl)(\([^)]+)\)$/, `$1a$2,${i})`);
}
function xr(e, t, n, r, i = []) {
	return function e(t, { n, p: r, r: i = [], i: a }, o) {
		let s = [], c = "", l = 0, u = 0;
		for (let p in t || {}) {
			var d, f;
			let m = t[p];
			if (p[0] == "@") {
				if (!m) continue;
				if (p[1] == "a") {
					s.push(...Tr(n, r, kr("" + m), o, r, i, a, !0));
					continue;
				}
				if (p[1] == "l") {
					for (let t of or(m)) s.push(...e(t, {
						n,
						p: (d = si[p[7]], r & ~si.o | d),
						r: p[7] == "d" ? [] : i,
						i: a
					}, o));
					continue;
				}
				if (p[1] == "i") {
					s.push(...or(m).map((e) => ({
						p: -1,
						o: 0,
						r: [],
						d: p + " " + e
					})));
					continue;
				}
				if (p[1] == "k") {
					s.push({
						p: si.d,
						o: 0,
						r: [p],
						d: e(m, { p: si.d }, o).map(fr).join("")
					});
					continue;
				}
				if (p[1] == "f") {
					s.push(...or(m).map((t) => ({
						p: si.d,
						o: 0,
						r: [p],
						d: e(t, { p: si.d }, o).map(fr).join("")
					})));
					continue;
				}
			}
			if (typeof m != "object" || Array.isArray(m)) p == "label" && m ? n = m + ir(JSON.stringify([
				r,
				a,
				t
			])) : (m || m === 0) && (p = p.replace(/[A-Z]/g, (e) => "-" + e.toLowerCase()), u += 1, l = Math.max(l, (f = p)[0] == "-" ? 0 : lr(f) + (/^(?:(border-(?!w|c|sty)|[tlbr].{2,4}m?$|c.{7,8}$)|([fl].{5}l|g.{8}$|pl))/.test(f) ? +!!RegExp.$1 || -!!RegExp.$2 : 0) + 1), c += (c ? ";" : "") + or(m).map((e) => o.s(p, Sr("" + e, o.theme) + (a ? " !important" : ""))).join(";"));
			else if (p[0] == "@" || p.includes("&")) {
				let t = r;
				p[0] == "@" && (p = p.replace(/\bscreen\(([^)]+)\)/g, (e, n) => {
					let r = o.theme("screens", n);
					return r ? (t |= 67108864, ar(r, "")) : e;
				}), t |= ur(p)), s.push(...e(m, {
					n,
					p: t,
					r: [...i, p],
					i: a
				}, o));
			} else s.push(...e(m, {
				p: r,
				r: [...i, p]
			}, o));
		}
		return s.unshift({
			n,
			p: r,
			o: Math.max(0, 15 - u) + 1.5 * Math.min(l || 15, 15),
			r: i,
			d: c
		}), s.sort(gr);
	}(e, dr(t, n, r, i), n);
}
function Sr(e, t) {
	return e.replace(/theme\((["'`])?(.+?)\1(?:\s*,\s*(["'`])?(.+?)\3)?\)/g, (e, n, r, i, a = "") => {
		let o = t(r, a);
		return typeof o == "function" && /color|fill|stroke/i.test(r) ? br(o) : "" + or(o).filter((e) => Object(e) !== e);
	});
}
function Cr(e, t) {
	let n, r = [];
	for (let i of e) i.d && i.n ? n?.p == i.p && "" + n.r == "" + i.r ? (n.c = [n.c, i.c].filter(Boolean).join(" "), n.d = n.d + ";" + i.d) : r.push(n = {
		...i,
		n: i.n && t
	}) : r.push({
		...i,
		n: i.n && t
	});
	return r;
}
function wr(e, t, n = si.u, r, i) {
	let a = [];
	for (let o of e) for (let e of function(e, t, n, r, i) {
		e = {
			...e,
			i: e.i || i
		};
		let a = function(e, t) {
			let n = li.get(e.n);
			return n ? n(e, t) : t.r(e.n, e.v[0] == "dark");
		}(e, t);
		return a ? typeof a == "string" ? ({r, p: n} = dr(e, t, n, r), Cr(wr(kr(a), t, n, r, e.i), e.n)) : Array.isArray(a) ? a.map((e) => {
			var t, i;
			return {
				o: 0,
				...e,
				r: [...or(r), ...or(e.r)],
				p: (t = n, i = e.p ?? n, t & ~si.o | i)
			};
		}) : xr(a, e, t, n, r) : [{
			c: nr(e),
			p: 0,
			o: 0,
			r: []
		}];
	}(o, t, n, r, i)) a.splice(hr(a, e), 0, e);
	return a;
}
function Tr(e, t, n, r, i, a, o, s) {
	return Cr((s ? n.flatMap((e) => wr([e], r, i, a, o)) : wr(n, r, i, a, o)).map((e) => e.p & si.o && (e.n || t == si.b) ? {
		...e,
		p: e.p & ~si.o | t,
		o: 0
	} : e), e);
}
function Er(e, t, n, r) {
	var i;
	return i = (e, i) => {
		let { n: a, p: o, r: s, i: c } = dr(e, i, t);
		return n && Tr(a, t, n, i, o, s, c, r);
	}, li.set(e, i), e;
}
function Dr(e, t, n) {
	if (e[e.length - 1] != "(") {
		let n = [], r = !1, i = !1, a = "";
		for (let t of e) if (!(t == "(" || /[~@]$/.test(t))) {
			if (t[0] == "!" && (t = t.slice(1), r = !r), t.endsWith(":")) {
				n[t == "dark:" ? "unshift" : "push"](t.slice(0, -1));
				continue;
			}
			t[0] == "-" && (t = t.slice(1), i = !i), t.endsWith("-") && (t = t.slice(0, -1)), t && t != "&" && (a += (a && "-") + t);
		}
		a && (i && (a = "-" + a), t[0].push({
			n: a,
			v: n.filter(Or),
			i: r
		}));
	}
}
function Or(e, t, n) {
	return n.indexOf(e) == t;
}
function kr(e) {
	let t = di.get(e);
	if (!t) {
		let n = [], r = [[]], i = 0, a = 0, o = null, s = 0, c = (t, a = 0) => {
			i != s && (n.push(e.slice(i, s + a)), t && Dr(n, r)), i = s + 1;
		};
		for (; s < e.length; s++) {
			let t = e[s];
			if (a) e[s - 1] != "\\" && (a += +(t == "[") || -(t == "]"));
			else if (t == "[") a += 1;
			else if (o) e[s - 1] != "\\" && o.test(e.slice(s)) && (o = null, i = s + RegExp.lastMatch.length);
			else if (t == "/" && e[s - 1] != "\\" && (e[s + 1] == "*" || e[s + 1] == "/")) o = e[s + 1] == "*" ? /^\*\// : /^[\r\n]/;
			else if (t == "(") c(), n.push(t);
			else if (t == ":") e[s + 1] != ":" && c(!1, 1);
			else if (/[\s,)]/.test(t)) {
				c(!0);
				let e = n.lastIndexOf("(");
				if (t == ")") {
					let t = n[e - 1];
					if (/[~@]$/.test(t)) {
						let i = r.shift();
						n.length = e, Dr([...n, "#"], r);
						let { v: a } = r[0].pop();
						for (let e of i) e.v.splice((e.v[0] == "dark") - +(a[0] == "dark"), a.length);
						Dr([...n, Er(t.length > 1 ? t.slice(0, -1) + ir(JSON.stringify([t, i])) : t + "(" + rr(i) + ")", si.a, i, /@$/.test(t))], r);
					}
					e = n.lastIndexOf("(", e - 1);
				}
				n.length = e + 1;
			} else /[~@]/.test(t) && e[s + 1] == "(" && r.unshift([]);
		}
		c(!0), di.set(e, t = r[0]);
	}
	return t;
}
function Ar(e, t, n) {
	return t.reduce((t, r, i) => t + n(r) + e[i + 1], e[0]);
}
function jr(e, t) {
	return Array.isArray(e) && Array.isArray(e.raw) ? Ar(e, t, (e) => Mr(e).trim()) : t.filter(Boolean).reduce((e, t) => e + Mr(t), e ? Mr(e) : "");
}
function Mr(e) {
	let t, n = "";
	if (e && typeof e == "object") if (Array.isArray(e)) (t = jr(e[0], e.slice(1))) && (n += " " + t);
	else for (let t in e) e[t] && (n += " " + t);
	else e != null && typeof e != "boolean" && (n += " " + e);
	return n;
}
function Nr(e, t) {
	return Array.isArray(e) ? Pr(Ar(e, t, (e) => e != null && typeof e != "boolean" ? e : "")) : typeof e == "string" ? Pr(e) : [e];
}
function Pr(e) {
	let t;
	e = e.replace(/\/\*[^]*?\*\/|\s\s+|\n/gm, " ");
	let n = [{}], r = [n[0]], i = [];
	for (; t = fi.exec(e);) t[4] && (n.shift(), i.shift()), t[3] ? (i.unshift(t[3]), n.unshift({}), r.push(i.reduce((e, t) => ({ [t]: e }), n[0]))) : t[4] || (n[0][t[1]] && (n.unshift({}), r.push(i.reduce((e, t) => ({ [t]: e }), n[0]))), n[0][t[1]] = t[2]);
	return r;
}
function Fr(e, ...t) {
	var n;
	let r = Nr(e, t), i = (r.find((e) => e.label)?.label || "css") + ir(JSON.stringify(r));
	return n = (e, t) => Cr(r.flatMap((n) => xr(n, e, t, si.o)), i), li.set(i, n), i;
}
function Y(e, t, n) {
	return [e, Ir(t, n)];
}
function Ir(e, t) {
	return typeof e == "function" ? e : typeof e == "string" && /^[\w-]+$/.test(e) ? (n, r) => ({ [e]: t ? t(n, r) : Lr(n, 1) }) : (t) => e || { [t[1]]: Lr(t, 2) };
}
function Lr(e, t, n = e.slice(t).find(Boolean) || e.$$ || e.input) {
	return e.input[0] == "-" ? `calc(${n} * -1)` : n;
}
function X(e, t, n, r) {
	return [e, Rr(t, n, r)];
}
function Rr(e, t, n) {
	let r = typeof t == "string" ? (e, r) => ({ [t]: n ? n(e, r) : e._ }) : t || (({ 1: e, _: t }, n, r) => ({ [e || r]: t }));
	return (t, n) => {
		let i = Wr(e || t[1]), a = n.theme(i, t.$$) ?? Ur(t.$$, i, n);
		if (a != null) return t._ = Lr(t, 0, a), r(t, n, i);
	};
}
function zr(e, t = {}, n) {
	return [e, Br(t, n)];
}
function Br(e = {}, t) {
	return (n, r) => {
		let { section: i = Wr(n[0]).replace("-", "") + "Color" } = e, [a, o] = Vr(n.$$);
		if (!a) return;
		let s = r.theme(i, a) || Ur(a, i, r);
		if (!s || typeof s == "object") return;
		let { opacityVariable: c = `--tw-${n[0].replace(/-$/, "")}-opacity`, opacitySection: l = i.replace("Color", "Opacity"), property: u = i, selector: d } = e, f = r.theme(l, o || "DEFAULT") || o && Ur(o, l, r), p = t || (({ _: e }) => {
			let t = Hr(u, e);
			return d ? { [d]: t } : t;
		});
		n._ = {
			value: br(s, {
				opacityVariable: c || void 0,
				opacityValue: f || void 0
			}),
			color: (e) => br(s, e),
			opacityVariable: c || void 0,
			opacityValue: f || void 0
		};
		let m = p(n, r);
		if (!n.dark) {
			let e = r.d(i, a, s);
			e && e !== s && (n._ = {
				value: br(e, {
					opacityVariable: c || void 0,
					opacityValue: f || "1"
				}),
				color: (t) => br(e, t),
				opacityVariable: c || void 0,
				opacityValue: f || void 0
			}, m = {
				"&": m,
				[r.v("dark")]: p(n, r)
			});
		}
		return m;
	};
}
function Vr(e) {
	return (e.match(/^(\[[^\]]+]|[^/]+?)(?:\/(.+))?$/) || []).slice(1);
}
function Hr(e, t) {
	let n = {};
	return typeof t == "string" ? n[e] = t : (t.opacityVariable && t.value.includes(t.opacityVariable) && (n[t.opacityVariable] = t.opacityValue || "1"), n[e] = t.value), n;
}
function Ur(e, t, n) {
	if (e[0] == "[" && e.slice(-1) == "]") {
		if (e = Gr(Sr(e.slice(1, -1), n.theme)), !t) return e;
		if (!(/color|fill|stroke/i.test(t) && !(/^color:/.test(e) || /^(#|((hsl|rgb)a?|hwb|lab|lch|color)\(|[a-z]+$)/.test(e)) || /image/i.test(t) && !(/^image:/.test(e) || /^[a-z-]+\(/.test(e)) || /weight/i.test(t) && !(/^(number|any):/.test(e) || /^\d+$/.test(e)) || /position/i.test(t) && /^(length|size):/.test(e))) return e.replace(/^[a-z-]+:/, "");
	}
}
function Wr(e) {
	return e.replace(/-./g, (e) => e[1].toUpperCase());
}
function Gr(e) {
	return e.includes("url(") ? e.replace(/(.*?)(url\(.*?\))(.*?)/g, (e, t = "", n, r = "") => Gr(t) + n + Gr(r)) : e.replace(/(^|[^\\])_+/g, (e, t) => t + " ".repeat(e.length - t.length)).replace(/\\_/g, "_").replace(/(calc|min|max|clamp)\(.+\)/g, (e) => e.replace(/(-?\d*\.?\d(?!\b-.+[,)](?![^+\-/*])\D)(?:%|[a-z]+)?|\))([+\-/*])/g, "$1 $2 "));
}
function Kr(e, ...t) {
	return rr(kr(jr(e, t)), " ");
}
function qr({ presets: e = [], ...t }) {
	let n = {
		darkMode: void 0,
		darkColor: void 0,
		preflight: !1 !== t.preflight && [],
		theme: {},
		variants: or(t.variants),
		rules: or(t.rules),
		ignorelist: or(t.ignorelist),
		hash: void 0,
		stringify: (e, t) => e + ":" + t,
		finalize: []
	};
	for (let r of or([...e, {
		darkMode: t.darkMode,
		darkColor: t.darkColor,
		preflight: !1 !== t.preflight && or(t.preflight),
		theme: t.theme,
		hash: t.hash,
		stringify: t.stringify,
		finalize: t.finalize
	}])) {
		let { preflight: e, darkMode: t = n.darkMode, darkColor: i = n.darkColor, theme: a, variants: o, rules: s, ignorelist: c, hash: l = n.hash, stringify: u = n.stringify, finalize: d } = typeof r == "function" ? r(n) : r;
		n = {
			preflight: !1 !== n.preflight && !1 !== e && [...n.preflight, ...or(e)],
			darkMode: t,
			darkColor: i,
			theme: {
				...n.theme,
				...a,
				extend: {
					...n.theme.extend,
					...a?.extend
				}
			},
			variants: [...n.variants, ...or(o)],
			rules: [...n.rules, ...or(s)],
			ignorelist: [...n.ignorelist, ...or(c)],
			hash: l,
			stringify: u,
			finalize: [...n.finalize, ...or(d)]
		};
	}
	return n;
}
function Jr(e, t, n, r, i, a) {
	for (let o of t) {
		let t = n.get(o);
		t || n.set(o, t = r(o));
		let s = t(e, i, a);
		if (s) return s;
	}
}
function Yr(e) {
	var t;
	return Zr(e[0], typeof (t = e[1]) == "function" ? t : () => t);
}
function Xr(e) {
	var t, n;
	return Array.isArray(e) ? Zr(e[0], Ir(e[1], e[2])) : Zr(e, Ir(t, n));
}
function Zr(e, t) {
	return Qr(e, (e, n, r, i) => {
		let a = n.exec(e);
		if (a) return a.$$ = e.slice(a[0].length), a.dark = i, t(a, r);
	});
}
function Qr(e, t) {
	let n = or(e).map($r);
	return (e, r, i) => {
		for (let a of n) {
			let n = t(e, a, r, i);
			if (n) return n;
		}
	};
}
function $r(e) {
	return typeof e == "string" ? RegExp("^" + e + (e.includes("$") || e.slice(-1) == "-" ? "" : "$")) : e;
}
function ei(e, t) {
	let n = qr(e), r = function({ theme: e, darkMode: t, darkColor: n = cr, variants: r, rules: i, hash: a, stringify: o, ignorelist: s, finalize: c }) {
		let l = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map(), p = Qr(s, (e, t) => t.test(e));
		r.push(["dark", Array.isArray(t) || t == "class" ? `${or(t)[1] || ".dark"} &` : typeof t == "string" && t != "media" ? t : "@media (prefers-color-scheme:dark)"]);
		let m = typeof a == "function" ? (e) => a(e, ir) : a ? ir : sr;
		m !== sr && c.push((e) => ({
			...e,
			n: e.n && m(e.n),
			d: e.d?.replace(/--(tw(?:-[\w-]+)?)\b/g, (e, t) => "--" + m(t).replace("#", ""))
		}));
		let h = {
			theme: function({ extend: e = {}, ...t }) {
				let n = {}, r = {
					get colors() {
						return i("colors");
					},
					theme: i,
					negative() {
						return {};
					},
					breakpoints(e) {
						let t = {};
						for (let n in e) typeof e[n] == "string" && (t["screen-" + n] = e[n]);
						return t;
					}
				};
				return i;
				function i(r, o, s, c) {
					if (r) {
						if ({1: r, 2: c} = /^(\S+?)(?:\s*\/\s*([^/]+))?$/.exec(r) || [, r], /[.[]/.test(r)) {
							let e = [];
							r.replace(/\[([^\]]+)\]|([^.[]+)/g, (t, n, r = n) => e.push(r)), r = e.shift(), s = o, o = e.join("-");
						}
						let l = n[r] || Object.assign(Object.assign(n[r] = {}, a(t, r)), a(e, r));
						if (o == null) return l;
						o ||= "DEFAULT";
						let u = l[o] ?? o.split("-").reduce((e, t) => e?.[t], l) ?? s;
						return c ? br(u, { opacityValue: Sr(c, i) }) : u;
					}
					let l = {};
					for (let n of [...Object.keys(t), ...Object.keys(e)]) l[n] = i(n);
					return l;
				}
				function a(e, t) {
					let n = e[t];
					return typeof n == "function" && (n = n(r)), n && /color|fill|stroke/i.test(t) ? function e(t, n = []) {
						let r = {};
						for (let i in t) {
							let a = t[i], o = [...n, i];
							r[o.join("-")] = a, i == "DEFAULT" && (o = n, r[n.join("-")] = a), typeof a == "object" && Object.assign(r, e(a, o));
						}
						return r;
					}(n) : n;
				}
			}(e),
			e: oi,
			h: m,
			s(e, t) {
				return o(e, t, h);
			},
			d(e, t, r) {
				return n(e, t, h, r);
			},
			v(e) {
				return l.has(e) || l.set(e, Jr(e, r, u, Yr, h) || "&:" + e), l.get(e);
			},
			r(e, t) {
				let n = JSON.stringify([e, t]);
				return d.has(n) || d.set(n, !p(e, h) && Jr(e, i, f, Xr, h, t)), d.get(n);
			},
			f(e) {
				return c.reduce((e, t) => t(e, h), e);
			}
		};
		return h;
	}(n), i = /* @__PURE__ */ new Map(), a = [], o = /* @__PURE__ */ new Set();
	t.resume((e) => i.set(e, e), (e, n) => {
		t.insert(e, a.length, n), a.push(n), o.add(e);
	});
	function s(e) {
		let n = r.f(e), i = fr(n);
		if (i && !o.has(i)) {
			o.add(i);
			let n = hr(a, e);
			t.insert(i, n, e), a.splice(n, 0, e);
		}
		return n.n;
	}
	return Object.defineProperties(function(e) {
		if (!i.size) for (let e of or(n.preflight)) typeof e == "function" && (e = e(r)), e && (typeof e == "string" ? Tr("", si.b, kr(e), r, si.b, [], !1, !0) : xr(e, {}, r, si.b)).forEach(s);
		e = "" + e;
		let t = i.get(e);
		if (!t) {
			let n = /* @__PURE__ */ new Set();
			for (let t of wr(kr(e), r)) n.add(t.c).add(s(t));
			t = [...n].filter(Boolean).join(" "), i.set(e, t).set(t, t);
		}
		return t;
	}, Object.getOwnPropertyDescriptors({
		get target() {
			return t.target;
		},
		theme: r.theme,
		config: n,
		snapshot() {
			let e = t.snapshot(), n = new Set(o), r = new Map(i), s = [...a];
			return () => {
				e(), o = n, i = r, a = s;
			};
		},
		clear() {
			t.clear(), o = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Map(), a = [];
		},
		destroy() {
			this.clear(), t.destroy();
		}
	}));
}
function ti(e) {
	let t = document.querySelector(e || "style[data-twind=\"\"]");
	return (!t || t.tagName != "STYLE") && (t = document.createElement("style"), document.head.prepend(t)), t.dataset.twind = "claimed", t;
}
function ni(e) {
	let t = e?.cssRules ? e : (e && typeof e != "string" ? e : ti(e)).sheet;
	return {
		target: t,
		snapshot() {
			let e = Array.from(t.cssRules, (e) => e.cssText);
			return () => {
				this.clear(), e.forEach(this.insert);
			};
		},
		clear() {
			for (let e = t.cssRules.length; e--;) t.deleteRule(e);
		},
		destroy() {
			t.ownerNode?.remove();
		},
		insert(e, n) {
			try {
				t.insertRule(e, n);
			} catch {
				t.insertRule(":root{}", n);
			}
		},
		resume: cr
	};
}
function ri(e) {
	let t = [];
	return {
		target: t,
		snapshot() {
			let e = [...t];
			return () => {
				t.splice(0, t.length, ...e);
			};
		},
		clear() {
			t.length = 0;
		},
		destroy() {
			this.clear();
		},
		insert(n, r, i) {
			t.splice(r, 0, e ? `/*!${i.p.toString(36)},${(2 * i.o).toString(36)}${i.n ? "," + i.n : ""}*/${n}` : n);
		},
		resume: cr
	};
}
function ii(e, t, n, r) {
	return { toString() {
		let i = Nr(n, r), a = oi(t + ir(JSON.stringify([t, i])));
		return (typeof e == "function" ? e : pi)(Fr({ [`@keyframes ${a}`]: Nr(n, r) })), a;
	} };
}
var ai, oi, si, ci, li, ui, di, fi, pi, mi, hi, gi, _i = t((() => {
	oi = typeof CSS < "u" && CSS.escape || ((e) => e.replace(/[!"'`*+.,;:\\/<=>?@#$%&^|~()[\]{}]/g, "\\$&").replace(/^\d/, "\\3$& ")), si = {
		d: 0,
		b: 134217728,
		c: 268435456,
		a: 671088640,
		u: 805306368,
		o: 939524096
	}, ci = [
		"rst-c",
		"st-ch",
		"h-chi",
		"y-lin",
		"nk",
		"sited",
		"ecked",
		"pty",
		"ad-on",
		"cus-w",
		"ver",
		"cus",
		"cus-v",
		"tive",
		"sable",
		"tiona",
		"quire"
	], li = /* @__PURE__ */ new Map(), ui = new Intl.Collator("en", { numeric: !0 }), di = /* @__PURE__ */ new Map(), fi = / *(?:(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}))/g, pi = /* #__PURE__ */ new Proxy(cr, {
		apply(e, t, n) {
			return ai(n[0]);
		},
		get(e, t) {
			let n = ai[t];
			return typeof n == "function" ? function() {
				return n.apply(ai, arguments);
			} : n;
		}
	}), mi = function(e, ...t) {
		(typeof this == "function" ? this : pi)(Fr({ "@layer base": Nr(e, t) }));
	}, hi = /* #__PURE__ */ function e(t) {
		return new Proxy(function(e, ...n) {
			return ii(t, "", e, n);
		}, { get(n, r) {
			return r === "bind" ? e : r in n ? n[r] : function(e, ...n) {
				return ii(t, r, e, n);
			};
		} });
	}(), gi = function(e, ...t) {
		return (typeof this == "function" ? this : pi)(jr(e, t));
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/style-vendorizer@2.2.3/node_modules/style-vendorizer/dist/esm/bundle.min.mjs
function vi(e) {
	return xi.get(e);
}
function yi(e) {
	var t = /^(?:(text-(?:decoration$|e|or|si)|back(?:ground-cl|d|f)|box-d|mask(?:$|-[ispro]|-cl)|pr|hyphena|flex-d)|(tab-|column(?!-s)|text-align-l)|(ap)|u|hy)/i.exec(e);
	return t ? t[1] ? 1 : t[2] ? 2 : t[3] ? 3 : 5 : 0;
}
function bi(e, t) {
	var n = /^(?:(pos)|(cli)|(background-i)|(flex(?:$|-b)|(?:max-|min-)?(?:block-s|inl|he|widt))|dis)/i.exec(e);
	return n ? n[1] ? +!!/^sti/i.test(t) : n[2] ? +!!/^pat/i.test(t) : n[3] ? +!!/^image-/i.test(t) : n[4] ? t[3] === "-" ? 2 : 0 : /^(?:inline-)?grid$/i.test(t) ? 4 : 0 : 0;
}
var xi, Si = t((() => {
	xi = /* @__PURE__ */ new Map([
		["align-self", "-ms-grid-row-align"],
		["color-adjust", "-webkit-print-color-adjust"],
		["column-gap", "grid-column-gap"],
		["forced-color-adjust", "-ms-high-contrast-adjust"],
		["gap", "grid-gap"],
		["grid-template-columns", "-ms-grid-columns"],
		["grid-template-rows", "-ms-grid-rows"],
		["justify-self", "-ms-grid-column-align"],
		["margin-inline-end", "-webkit-margin-end"],
		["margin-inline-start", "-webkit-margin-start"],
		["mask-border", "-webkit-mask-box-image"],
		["mask-border-outset", "-webkit-mask-box-image-outset"],
		["mask-border-slice", "-webkit-mask-box-image-slice"],
		["mask-border-source", "-webkit-mask-box-image-source"],
		["mask-border-repeat", "-webkit-mask-box-image-repeat"],
		["mask-border-width", "-webkit-mask-box-image-width"],
		["overflow-wrap", "word-wrap"],
		["padding-inline-end", "-webkit-padding-end"],
		["padding-inline-start", "-webkit-padding-start"],
		["print-color-adjust", "color-adjust"],
		["row-gap", "grid-row-gap"],
		["scroll-margin-bottom", "scroll-snap-margin-bottom"],
		["scroll-margin-left", "scroll-snap-margin-left"],
		["scroll-margin-right", "scroll-snap-margin-right"],
		["scroll-margin-top", "scroll-snap-margin-top"],
		["scroll-margin", "scroll-snap-margin"],
		["text-combine-upright", "-ms-text-combine-horizontal"]
	]);
}));
//#endregion
//#region ../../node_modules/.pnpm/@twind+preset-autoprefix@1.0.7_@twind+core@1.1.3_typescript@5.9.2__typescript@5.9.2/node_modules/@twind/preset-autoprefix/preset-autoprefix.js
function Ci() {
	return ({ stringify: e }) => ({ stringify(t, n, r) {
		let i = "", a = vi(t);
		a && (i += e(a, n, r) + ";");
		let o = yi(t), s = bi(t, n);
		for (let a of wi) o & a[1] && (i += e(a[0] + t, n, r) + ";"), s & a[1] && (i += e(t, a[0] + n, r) + ";");
		return i + e(t, n, r);
	} });
}
var wi, Ti = t((() => {
	Si(), wi = [
		["-webkit-", 1],
		["-moz-", 2],
		["-ms-", 4]
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/@twind+preset-tailwind@1.1.4_@twind+core@1.1.3_typescript@5.9.2__typescript@5.9.2/node_modules/@twind/preset-tailwind/baseTheme.js
function Ei(e, t) {
	let n = {};
	do
		for (var r = 1; r < e; r++) n[`${r}/${e}`] = Number((r / e * 100).toFixed(6)) + "%";
	while (++e <= t);
	return n;
}
function Di(e, t, n = 0) {
	let r = {};
	for (; n <= e; n = 2 * n || 1) r[n] = n + t;
	return r;
}
function Oi(e, t = "", n = 1, r = 0, i = 1, a = {}) {
	for (; r <= e; r += i) a[r] = r / n + t;
	return a;
}
function Z(e) {
	return ({ theme: t }) => t(e);
}
var ki, Ai = t((() => {
	ki = {
		screens: {
			sm: "640px",
			md: "768px",
			lg: "1024px",
			xl: "1280px",
			"2xl": "1536px"
		},
		columns: {
			auto: "auto",
			"3xs": "16rem",
			"2xs": "18rem",
			xs: "20rem",
			sm: "24rem",
			md: "28rem",
			lg: "32rem",
			xl: "36rem",
			"2xl": "42rem",
			"3xl": "48rem",
			"4xl": "56rem",
			"5xl": "64rem",
			"6xl": "72rem",
			"7xl": "80rem"
		},
		spacing: {
			px: "1px",
			0: "0px",
			.../* #__PURE__ */ Oi(4, "rem", 4, .5, .5),
			.../* #__PURE__ */ Oi(12, "rem", 4, 5),
			14: "3.5rem",
			.../* #__PURE__ */ Oi(64, "rem", 4, 16, 4),
			72: "18rem",
			80: "20rem",
			96: "24rem"
		},
		durations: {
			75: "75ms",
			100: "100ms",
			150: "150ms",
			200: "200ms",
			300: "300ms",
			500: "500ms",
			700: "700ms",
			1e3: "1000ms"
		},
		animation: {
			none: "none",
			spin: "spin 1s linear infinite",
			ping: "ping 1s cubic-bezier(0,0,0.2,1) infinite",
			pulse: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
			bounce: "bounce 1s infinite"
		},
		aspectRatio: {
			auto: "auto",
			square: "1/1",
			video: "16/9"
		},
		backdropBlur: /* #__PURE__ */ Z("blur"),
		backdropBrightness: /* #__PURE__ */ Z("brightness"),
		backdropContrast: /* #__PURE__ */ Z("contrast"),
		backdropGrayscale: /* #__PURE__ */ Z("grayscale"),
		backdropHueRotate: /* #__PURE__ */ Z("hueRotate"),
		backdropInvert: /* #__PURE__ */ Z("invert"),
		backdropOpacity: /* #__PURE__ */ Z("opacity"),
		backdropSaturate: /* #__PURE__ */ Z("saturate"),
		backdropSepia: /* #__PURE__ */ Z("sepia"),
		backgroundColor: /* #__PURE__ */ Z("colors"),
		backgroundImage: { none: "none" },
		backgroundOpacity: /* #__PURE__ */ Z("opacity"),
		backgroundSize: {
			auto: "auto",
			cover: "cover",
			contain: "contain"
		},
		blur: {
			none: "none",
			0: "0",
			sm: "4px",
			DEFAULT: "8px",
			md: "12px",
			lg: "16px",
			xl: "24px",
			"2xl": "40px",
			"3xl": "64px"
		},
		brightness: {
			.../* #__PURE__ */ Oi(200, "", 100, 0, 50),
			.../* #__PURE__ */ Oi(110, "", 100, 90, 5),
			75: "0.75",
			125: "1.25"
		},
		borderColor: ({ theme: e }) => ({
			DEFAULT: e("colors.gray.200", "currentColor"),
			...e("colors")
		}),
		borderOpacity: /* #__PURE__ */ Z("opacity"),
		borderRadius: {
			none: "0px",
			sm: "0.125rem",
			DEFAULT: "0.25rem",
			md: "0.375rem",
			lg: "0.5rem",
			xl: "0.75rem",
			"2xl": "1rem",
			"3xl": "1.5rem",
			"1/2": "50%",
			full: "9999px"
		},
		borderSpacing: /* #__PURE__ */ Z("spacing"),
		borderWidth: {
			DEFAULT: "1px",
			.../* #__PURE__ */ Di(8, "px")
		},
		boxShadow: {
			sm: "0 1px 2px 0 rgba(0,0,0,0.05)",
			DEFAULT: "0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)",
			md: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)",
			lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
			xl: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
			"2xl": "0 25px 50px -12px rgba(0,0,0,0.25)",
			inner: "inset 0 2px 4px 0 rgba(0,0,0,0.05)",
			none: "0 0 #0000"
		},
		boxShadowColor: Z("colors"),
		caretColor: /* #__PURE__ */ Z("colors"),
		accentColor: ({ theme: e }) => ({
			auto: "auto",
			...e("colors")
		}),
		contrast: {
			.../* #__PURE__ */ Oi(200, "", 100, 0, 50),
			75: "0.75",
			125: "1.25"
		},
		content: { none: "none" },
		divideColor: /* #__PURE__ */ Z("borderColor"),
		divideOpacity: /* #__PURE__ */ Z("borderOpacity"),
		divideWidth: /* #__PURE__ */ Z("borderWidth"),
		dropShadow: {
			sm: "0 1px 1px rgba(0,0,0,0.05)",
			DEFAULT: ["0 1px 2px rgba(0,0,0,0.1)", "0 1px 1px rgba(0,0,0,0.06)"],
			md: ["0 4px 3px rgba(0,0,0,0.07)", "0 2px 2px rgba(0,0,0,0.06)"],
			lg: ["0 10px 8px rgba(0,0,0,0.04)", "0 4px 3px rgba(0,0,0,0.1)"],
			xl: ["0 20px 13px rgba(0,0,0,0.03)", "0 8px 5px rgba(0,0,0,0.08)"],
			"2xl": "0 25px 25px rgba(0,0,0,0.15)",
			none: "0 0 #0000"
		},
		fill: ({ theme: e }) => ({
			...e("colors"),
			none: "none"
		}),
		grayscale: {
			DEFAULT: "100%",
			0: "0"
		},
		hueRotate: {
			0: "0deg",
			15: "15deg",
			30: "30deg",
			60: "60deg",
			90: "90deg",
			180: "180deg"
		},
		invert: {
			DEFAULT: "100%",
			0: "0"
		},
		flex: {
			1: "1 1 0%",
			auto: "1 1 auto",
			initial: "0 1 auto",
			none: "none"
		},
		flexBasis: ({ theme: e }) => ({
			...e("spacing"),
			...Ei(2, 6),
			...Ei(12, 12),
			auto: "auto",
			full: "100%"
		}),
		flexGrow: {
			DEFAULT: 1,
			0: 0
		},
		flexShrink: {
			DEFAULT: 1,
			0: 0
		},
		fontFamily: {
			sans: "ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,\"Noto Sans\",sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Segoe UI Symbol\",\"Noto Color Emoji\"".split(","),
			serif: "ui-serif,Georgia,Cambria,\"Times New Roman\",Times,serif".split(","),
			mono: "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace".split(",")
		},
		fontSize: {
			xs: ["0.75rem", "1rem"],
			sm: ["0.875rem", "1.25rem"],
			base: ["1rem", "1.5rem"],
			lg: ["1.125rem", "1.75rem"],
			xl: ["1.25rem", "1.75rem"],
			"2xl": ["1.5rem", "2rem"],
			"3xl": ["1.875rem", "2.25rem"],
			"4xl": ["2.25rem", "2.5rem"],
			"5xl": ["3rem", "1"],
			"6xl": ["3.75rem", "1"],
			"7xl": ["4.5rem", "1"],
			"8xl": ["6rem", "1"],
			"9xl": ["8rem", "1"]
		},
		fontWeight: {
			thin: "100",
			extralight: "200",
			light: "300",
			normal: "400",
			medium: "500",
			semibold: "600",
			bold: "700",
			extrabold: "800",
			black: "900"
		},
		gap: /* #__PURE__ */ Z("spacing"),
		gradientColorStops: /* #__PURE__ */ Z("colors"),
		gridAutoColumns: {
			auto: "auto",
			min: "min-content",
			max: "max-content",
			fr: "minmax(0,1fr)"
		},
		gridAutoRows: {
			auto: "auto",
			min: "min-content",
			max: "max-content",
			fr: "minmax(0,1fr)"
		},
		gridColumn: {
			auto: "auto",
			"span-full": "1 / -1"
		},
		gridRow: {
			auto: "auto",
			"span-full": "1 / -1"
		},
		gridTemplateColumns: { none: "none" },
		gridTemplateRows: { none: "none" },
		height: ({ theme: e }) => ({
			...e("spacing"),
			...Ei(2, 6),
			min: "min-content",
			max: "max-content",
			fit: "fit-content",
			auto: "auto",
			full: "100%",
			screen: "100vh"
		}),
		inset: ({ theme: e }) => ({
			...e("spacing"),
			...Ei(2, 4),
			auto: "auto",
			full: "100%"
		}),
		keyframes: {
			spin: {
				from: { transform: "rotate(0deg)" },
				to: { transform: "rotate(360deg)" }
			},
			ping: {
				"0%": {
					transform: "scale(1)",
					opacity: "1"
				},
				"75%,100%": {
					transform: "scale(2)",
					opacity: "0"
				}
			},
			pulse: {
				"0%,100%": { opacity: "1" },
				"50%": { opacity: ".5" }
			},
			bounce: {
				"0%, 100%": {
					transform: "translateY(-25%)",
					animationTimingFunction: "cubic-bezier(0.8,0,1,1)"
				},
				"50%": {
					transform: "none",
					animationTimingFunction: "cubic-bezier(0,0,0.2,1)"
				}
			}
		},
		letterSpacing: {
			tighter: "-0.05em",
			tight: "-0.025em",
			normal: "0em",
			wide: "0.025em",
			wider: "0.05em",
			widest: "0.1em"
		},
		lineHeight: {
			.../* #__PURE__ */ Oi(10, "rem", 4, 3),
			none: "1",
			tight: "1.25",
			snug: "1.375",
			normal: "1.5",
			relaxed: "1.625",
			loose: "2"
		},
		margin: ({ theme: e }) => ({
			auto: "auto",
			...e("spacing")
		}),
		maxHeight: ({ theme: e }) => ({
			full: "100%",
			min: "min-content",
			max: "max-content",
			fit: "fit-content",
			screen: "100vh",
			...e("spacing")
		}),
		maxWidth: ({ theme: e, breakpoints: t }) => ({
			...t(e("screens")),
			none: "none",
			0: "0rem",
			xs: "20rem",
			sm: "24rem",
			md: "28rem",
			lg: "32rem",
			xl: "36rem",
			"2xl": "42rem",
			"3xl": "48rem",
			"4xl": "56rem",
			"5xl": "64rem",
			"6xl": "72rem",
			"7xl": "80rem",
			full: "100%",
			min: "min-content",
			max: "max-content",
			fit: "fit-content",
			prose: "65ch"
		}),
		minHeight: {
			0: "0px",
			full: "100%",
			min: "min-content",
			max: "max-content",
			fit: "fit-content",
			screen: "100vh"
		},
		minWidth: {
			0: "0px",
			full: "100%",
			min: "min-content",
			max: "max-content",
			fit: "fit-content"
		},
		opacity: {
			.../* #__PURE__ */ Oi(100, "", 100, 0, 10),
			5: "0.05",
			25: "0.25",
			75: "0.75",
			95: "0.95"
		},
		order: {
			first: "-9999",
			last: "9999",
			none: "0"
		},
		padding: /* #__PURE__ */ Z("spacing"),
		placeholderColor: /* #__PURE__ */ Z("colors"),
		placeholderOpacity: /* #__PURE__ */ Z("opacity"),
		outlineColor: /* #__PURE__ */ Z("colors"),
		outlineOffset: /* #__PURE__ */ Di(8, "px"),
		outlineWidth: /* #__PURE__ */ Di(8, "px"),
		ringColor: ({ theme: e }) => ({
			...e("colors"),
			DEFAULT: "#3b82f6"
		}),
		ringOffsetColor: /* #__PURE__ */ Z("colors"),
		ringOffsetWidth: /* #__PURE__ */ Di(8, "px"),
		ringOpacity: ({ theme: e }) => ({
			...e("opacity"),
			DEFAULT: "0.5"
		}),
		ringWidth: {
			DEFAULT: "3px",
			.../* #__PURE__ */ Di(8, "px")
		},
		rotate: {
			.../* #__PURE__ */ Di(2, "deg"),
			.../* #__PURE__ */ Di(12, "deg", 3),
			.../* #__PURE__ */ Di(180, "deg", 45)
		},
		saturate: /* #__PURE__ */ Oi(200, "", 100, 0, 50),
		scale: {
			.../* #__PURE__ */ Oi(150, "", 100, 0, 50),
			.../* #__PURE__ */ Oi(110, "", 100, 90, 5),
			75: "0.75",
			125: "1.25"
		},
		scrollMargin: /* #__PURE__ */ Z("spacing"),
		scrollPadding: /* #__PURE__ */ Z("spacing"),
		sepia: {
			0: "0",
			DEFAULT: "100%"
		},
		skew: {
			.../* #__PURE__ */ Di(2, "deg"),
			.../* #__PURE__ */ Di(12, "deg", 3)
		},
		space: /* #__PURE__ */ Z("spacing"),
		stroke: ({ theme: e }) => ({
			...e("colors"),
			none: "none"
		}),
		strokeWidth: /* #__PURE__ */ Oi(2),
		textColor: /* #__PURE__ */ Z("colors"),
		textDecorationColor: /* #__PURE__ */ Z("colors"),
		textDecorationThickness: {
			"from-font": "from-font",
			auto: "auto",
			.../* #__PURE__ */ Di(8, "px")
		},
		textUnderlineOffset: {
			auto: "auto",
			.../* #__PURE__ */ Di(8, "px")
		},
		textIndent: /* #__PURE__ */ Z("spacing"),
		textOpacity: /* #__PURE__ */ Z("opacity"),
		transitionDuration: ({ theme: e }) => ({
			...e("durations"),
			DEFAULT: "150ms"
		}),
		transitionDelay: /* #__PURE__ */ Z("durations"),
		transitionProperty: {
			none: "none",
			all: "all",
			DEFAULT: "color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter",
			colors: "color,background-color,border-color,text-decoration-color,fill,stroke",
			opacity: "opacity",
			shadow: "box-shadow",
			transform: "transform"
		},
		transitionTimingFunction: {
			DEFAULT: "cubic-bezier(0.4,0,0.2,1)",
			linear: "linear",
			in: "cubic-bezier(0.4,0,1,1)",
			out: "cubic-bezier(0,0,0.2,1)",
			"in-out": "cubic-bezier(0.4,0,0.2,1)"
		},
		translate: ({ theme: e }) => ({
			...e("spacing"),
			...Ei(2, 4),
			full: "100%"
		}),
		width: ({ theme: e }) => ({
			min: "min-content",
			max: "max-content",
			fit: "fit-content",
			screen: "100vw",
			...e("flexBasis")
		}),
		willChange: { scroll: "scroll-position" },
		zIndex: {
			.../* #__PURE__ */ Oi(50, "", 1, 0, 10),
			auto: "auto"
		}
	};
})), ji, Mi = t((() => {
	Ai(), ji = {
		"*,::before,::after": {
			boxSizing: "border-box",
			borderWidth: "0",
			borderStyle: "solid",
			borderColor: "theme(borderColor.DEFAULT, currentColor)"
		},
		"::before,::after": { "--tw-content": "''" },
		html: {
			lineHeight: 1.5,
			WebkitTextSizeAdjust: "100%",
			MozTabSize: "4",
			tabSize: 4,
			fontFamily: `theme(fontFamily.sans, ${ki.fontFamily.sans})`,
			fontFeatureSettings: "theme(fontFamily.sans[1].fontFeatureSettings, normal)"
		},
		body: {
			margin: "0",
			lineHeight: "inherit"
		},
		hr: {
			height: "0",
			color: "inherit",
			borderTopWidth: "1px"
		},
		"abbr:where([title])": { textDecoration: "underline dotted" },
		"h1,h2,h3,h4,h5,h6": {
			fontSize: "inherit",
			fontWeight: "inherit"
		},
		a: {
			color: "inherit",
			textDecoration: "inherit"
		},
		"b,strong": { fontWeight: "bolder" },
		"code,kbd,samp,pre": {
			fontFamily: `theme(fontFamily.mono, ${ki.fontFamily.mono})`,
			fontFeatureSettings: "theme(fontFamily.mono[1].fontFeatureSettings, normal)",
			fontSize: "1em"
		},
		small: { fontSize: "80%" },
		"sub,sup": {
			fontSize: "75%",
			lineHeight: 0,
			position: "relative",
			verticalAlign: "baseline"
		},
		sub: { bottom: "-0.25em" },
		sup: { top: "-0.5em" },
		table: {
			textIndent: "0",
			borderColor: "inherit",
			borderCollapse: "collapse"
		},
		"button,input,optgroup,select,textarea": {
			fontFamily: "inherit",
			fontSize: "100%",
			lineHeight: "inherit",
			color: "inherit",
			margin: "0",
			padding: "0"
		},
		"button,select": { textTransform: "none" },
		"button,[type='button'],[type='reset'],[type='submit']": {
			WebkitAppearance: "button",
			backgroundColor: "transparent",
			backgroundImage: "none"
		},
		":-moz-focusring": { outline: "auto" },
		":-moz-ui-invalid": { boxShadow: "none" },
		progress: { verticalAlign: "baseline" },
		"::-webkit-inner-spin-button,::-webkit-outer-spin-button": { height: "auto" },
		"[type='search']": {
			WebkitAppearance: "textfield",
			outlineOffset: "-2px"
		},
		"::-webkit-search-decoration": { WebkitAppearance: "none" },
		"::-webkit-file-upload-button": {
			WebkitAppearance: "button",
			font: "inherit"
		},
		summary: { display: "list-item" },
		"blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre": { margin: "0" },
		fieldset: {
			margin: "0",
			padding: "0"
		},
		legend: { padding: "0" },
		"ol,ul,menu": {
			listStyle: "none",
			margin: "0",
			padding: "0"
		},
		textarea: { resize: "vertical" },
		"input::placeholder,textarea::placeholder": {
			opacity: 1,
			color: "theme(colors.gray.400, #9ca3af)"
		},
		"button,[role=\"button\"]": { cursor: "pointer" },
		":disabled": { cursor: "default" },
		"img,svg,video,canvas,audio,iframe,embed,object": {
			display: "block",
			verticalAlign: "middle"
		},
		"img,video": {
			maxWidth: "100%",
			height: "auto"
		},
		"[hidden]": { display: "none" }
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@twind+preset-tailwind@1.1.4_@twind+core@1.1.3_typescript@5.9.2__typescript@5.9.2/node_modules/@twind/preset-tailwind/rules.js
function Ni(e) {
	return (typeof e == "string" ? e : e[1]).replace(/-/g, " ").trim();
}
function Pi(e) {
	return (typeof e == "string" ? e : e[1]).replace("col", "column");
}
function Fi(e, t = "-") {
	let n = [];
	for (let t of e) n.push({
		t: "top",
		r: "right",
		b: "bottom",
		l: "left"
	}[t]);
	return n.join(t);
}
function Ii(e) {
	return e && "" + (e._ || e);
}
function Li({ $$: e }) {
	return ({
		r: "flex-",
		"": "flex-",
		w: "space-",
		u: "space-",
		n: "space-"
	}[e[3] || ""] || "") + e;
}
function Ri(e, t = "") {
	return ({ 1: n, _: r }) => {
		let i = {
			x: "lr",
			y: "tb"
		}[n] || n + n;
		return i ? {
			...Hr(e + "-" + Fi(i[0]) + t, r),
			...Hr(e + "-" + Fi(i[1]) + t, r)
		} : Hr(e + t, r);
	};
}
function zi(e = "") {
	let t = [
		"blur",
		"brightness",
		"contrast",
		"grayscale",
		"hue-rotate",
		"invert",
		e && "opacity",
		"saturate",
		"sepia",
		!e && "drop-shadow"
	].filter(Boolean), n = {};
	for (let r of t) n[`--tw-${e}${r}`] = "var(--tw-empty,/*!*/ /*!*/)";
	return n = {
		...Gi(n),
		[`${e}filter`]: t.map((t) => `var(--tw-${e}${t})`).join(" ")
	}, [
		`(${e}filter)-(none)`,
		Y(`${e}filter`, n),
		...t.map((t) => X(`${t[0] == "h" ? "-?" : ""}(${e}${t})(?:$|-)`, t, ({ 1: e, _: r }) => ({
			[`--tw-${e}`]: or(r).map((e) => `${t}(${e})`).join(" "),
			...n
		})))
	];
}
function Bi({ 1: e, _: t }) {
	return {
		["--tw-" + e]: t,
		...Vi()
	};
}
function Vi() {
	return {
		...Gi({
			"--tw-translate-x": "0",
			"--tw-translate-y": "0",
			"--tw-rotate": "0",
			"--tw-skew-x": "0",
			"--tw-skew-y": "0",
			"--tw-scale-x": "1",
			"--tw-scale-y": "1",
			"--tw-transform": Hi()
		}),
		transform: "var(--tw-transform)"
	};
}
function Hi(e) {
	return [
		e ? "translate3d(var(--tw-translate-x),var(--tw-translate-y),0)" : "translateX(var(--tw-translate-x)) translateY(var(--tw-translate-y))",
		"rotate(var(--tw-rotate))",
		"skewX(var(--tw-skew-x))",
		"skewY(var(--tw-skew-y))",
		"scaleX(var(--tw-scale-x))",
		"scaleY(var(--tw-scale-y))"
	].join(" ");
}
function Ui({ 1: e, 2: t }) {
	return `${e} ${t} / ${e} ${t}`;
}
function Wi({ 1: e }) {
	return `repeat(${e},minmax(0,1fr))`;
}
function Gi(e) {
	return { "@layer defaults": {
		"*,::before,::after": e,
		"::backdrop": e
	} };
}
var Ki, qi = t((() => {
	_i(), Ki = [
		Y("\\[([-\\w]+):(.+)]", ({ 1: e, 2: t }, n) => ({ "@layer overrides": { "&": { [e]: Ur(`[${t}]`, "", n) } } })),
		Y("(group|peer)([~/][^-[]+)?", ({ input: e }, { h: t }) => [{ c: t(e) }]),
		X("aspect-", "aspectRatio"),
		Y("container", (e, { theme: t }) => {
			let { screens: n = t("screens"), center: r, padding: i } = t("container"), a = {
				width: "100%",
				marginRight: r && "auto",
				marginLeft: r && "auto",
				...o("xs")
			};
			for (let e in n) {
				let t = n[e];
				typeof t == "string" && (a[ar(t)] = { "&": {
					maxWidth: t,
					...o(e)
				} });
			}
			return a;
			function o(e) {
				let t = i && (typeof i == "string" ? i : i[e] || i.DEFAULT);
				if (t) return {
					paddingRight: t,
					paddingLeft: t
				};
			}
		}),
		X("content-", "content", ({ _: e }) => ({
			"--tw-content": e,
			content: "var(--tw-content)"
		})),
		Y("(?:box-)?decoration-(slice|clone)", "boxDecorationBreak"),
		Y("box-(border|content)", "boxSizing", ({ 1: e }) => e + "-box"),
		Y("hidden", { display: "none" }),
		Y("table-(auto|fixed)", "tableLayout"),
		Y([
			"(block|flex|table|grid|inline|contents|flow-root|list-item)",
			"(inline-(block|flex|table|grid))",
			"(table-(caption|cell|column|row|(column|row|footer|header)-group))"
		], "display"),
		"(float)-(left|right|none)",
		"(clear)-(left|right|none|both)",
		"(overflow(?:-[xy])?)-(auto|hidden|clip|visible|scroll)",
		"(isolation)-(auto)",
		Y("isolate", "isolation"),
		Y("object-(contain|cover|fill|none|scale-down)", "objectFit"),
		X("object-", "objectPosition"),
		Y("object-(top|bottom|center|(left|right)(-(top|bottom))?)", "objectPosition", Ni),
		Y("overscroll(-[xy])?-(auto|contain|none)", ({ 1: e = "", 2: t }) => ({ ["overscroll-behavior" + e]: t })),
		Y("(static|fixed|absolute|relative|sticky)", "position"),
		X("-?inset(-[xy])?(?:$|-)", "inset", ({ 1: e, _: t }) => ({
			top: e != "-x" && t,
			right: e != "-y" && t,
			bottom: e != "-x" && t,
			left: e != "-y" && t
		})),
		X("-?(top|bottom|left|right)(?:$|-)", "inset"),
		Y("(visible|collapse)", "visibility"),
		Y("invisible", { visibility: "hidden" }),
		X("-?z-", "zIndex"),
		Y("flex-((row|col)(-reverse)?)", "flexDirection", Pi),
		Y("flex-(wrap|wrap-reverse|nowrap)", "flexWrap"),
		X("(flex-(?:grow|shrink))(?:$|-)"),
		X("(flex)-"),
		X("grow(?:$|-)", "flexGrow"),
		X("shrink(?:$|-)", "flexShrink"),
		X("basis-", "flexBasis"),
		X("-?(order)-"),
		"-?(order)-(\\d+)",
		X("grid-cols-", "gridTemplateColumns"),
		Y("grid-cols-(\\d+)", "gridTemplateColumns", Wi),
		X("col-", "gridColumn"),
		Y("col-(span)-(\\d+)", "gridColumn", Ui),
		X("col-start-", "gridColumnStart"),
		Y("col-start-(auto|\\d+)", "gridColumnStart"),
		X("col-end-", "gridColumnEnd"),
		Y("col-end-(auto|\\d+)", "gridColumnEnd"),
		X("grid-rows-", "gridTemplateRows"),
		Y("grid-rows-(\\d+)", "gridTemplateRows", Wi),
		X("row-", "gridRow"),
		Y("row-(span)-(\\d+)", "gridRow", Ui),
		X("row-start-", "gridRowStart"),
		Y("row-start-(auto|\\d+)", "gridRowStart"),
		X("row-end-", "gridRowEnd"),
		Y("row-end-(auto|\\d+)", "gridRowEnd"),
		Y("grid-flow-((row|col)(-dense)?)", "gridAutoFlow", (e) => Ni(Pi(e))),
		Y("grid-flow-(dense)", "gridAutoFlow"),
		X("auto-cols-", "gridAutoColumns"),
		X("auto-rows-", "gridAutoRows"),
		X("gap-x(?:$|-)", "gap", "columnGap"),
		X("gap-y(?:$|-)", "gap", "rowGap"),
		X("gap(?:$|-)", "gap"),
		"(justify-(?:items|self))-",
		Y("justify-", "justifyContent", Li),
		Y("(content|items|self)-", (e) => ({ ["align-" + e[1]]: Li(e) })),
		Y("(place-(content|items|self))-", ({ 1: e, $$: t }) => ({ [e]: ("wun".includes(t[3]) ? "space-" : "") + t })),
		X("p([xytrbl])?(?:$|-)", "padding", Ri("padding")),
		X("-?m([xytrbl])?(?:$|-)", "margin", Ri("margin")),
		X("-?space-(x|y)(?:$|-)", "space", ({ 1: e, _: t }) => ({ "&>:not([hidden])~:not([hidden])": {
			[`--tw-space-${e}-reverse`]: "0",
			["margin-" + {
				y: "top",
				x: "left"
			}[e]]: `calc(${t} * calc(1 - var(--tw-space-${e}-reverse)))`,
			["margin-" + {
				y: "bottom",
				x: "right"
			}[e]]: `calc(${t} * var(--tw-space-${e}-reverse))`
		} })),
		Y("space-(x|y)-reverse", ({ 1: e }) => ({ "&>:not([hidden])~:not([hidden])": { [`--tw-space-${e}-reverse`]: "1" } })),
		X("w-", "width"),
		X("min-w-", "minWidth"),
		X("max-w-", "maxWidth"),
		X("h-", "height"),
		X("min-h-", "minHeight"),
		X("max-h-", "maxHeight"),
		X("font-", "fontWeight"),
		X("font-", "fontFamily", ({ _: e }) => typeof (e = or(e))[1] == "string" ? { fontFamily: Ii(e) } : {
			fontFamily: Ii(e[0]),
			...e[1]
		}),
		Y("antialiased", {
			WebkitFontSmoothing: "antialiased",
			MozOsxFontSmoothing: "grayscale"
		}),
		Y("subpixel-antialiased", {
			WebkitFontSmoothing: "auto",
			MozOsxFontSmoothing: "auto"
		}),
		Y("italic", "fontStyle"),
		Y("not-italic", { fontStyle: "normal" }),
		Y("(ordinal|slashed-zero|(normal|lining|oldstyle|proportional|tabular)-nums|(diagonal|stacked)-fractions)", ({ 1: e, 2: t = "", 3: n }) => t == "normal" ? { fontVariantNumeric: "normal" } : {
			["--tw-" + (n ? "numeric-fraction" : "pt".includes(t[0]) ? "numeric-spacing" : t ? "numeric-figure" : e)]: e,
			fontVariantNumeric: "var(--tw-ordinal) var(--tw-slashed-zero) var(--tw-numeric-figure) var(--tw-numeric-spacing) var(--tw-numeric-fraction)",
			...Gi({
				"--tw-ordinal": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-slashed-zero": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-numeric-figure": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-numeric-spacing": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-numeric-fraction": "var(--tw-empty,/*!*/ /*!*/)"
			})
		}),
		X("tracking-", "letterSpacing"),
		X("leading-", "lineHeight"),
		Y("list-(inside|outside)", "listStylePosition"),
		X("list-", "listStyleType"),
		Y("list-", "listStyleType"),
		X("placeholder-opacity-", "placeholderOpacity", ({ _: e }) => ({ "&::placeholder": { "--tw-placeholder-opacity": e } })),
		zr("placeholder-", {
			property: "color",
			selector: "&::placeholder"
		}),
		Y("text-(left|center|right|justify|start|end)", "textAlign"),
		Y("text-(ellipsis|clip)", "textOverflow"),
		X("text-opacity-", "textOpacity", "--tw-text-opacity"),
		zr("text-", { property: "color" }),
		X("text-", "fontSize", ({ _: e }) => typeof e == "string" ? { fontSize: e } : {
			fontSize: e[0],
			...typeof e[1] == "string" ? { lineHeight: e[1] } : e[1]
		}),
		X("indent-", "textIndent"),
		Y("(overline|underline|line-through)", "textDecorationLine"),
		Y("no-underline", { textDecorationLine: "none" }),
		X("underline-offset-", "textUnderlineOffset"),
		zr("decoration-", {
			section: "textDecorationColor",
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		X("decoration-", "textDecorationThickness"),
		Y("decoration-", "textDecorationStyle"),
		Y("(uppercase|lowercase|capitalize)", "textTransform"),
		Y("normal-case", { textTransform: "none" }),
		Y("truncate", {
			overflow: "hidden",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis"
		}),
		Y("align-", "verticalAlign"),
		Y("whitespace-", "whiteSpace"),
		Y("break-normal", {
			wordBreak: "normal",
			overflowWrap: "normal"
		}),
		Y("break-words", { overflowWrap: "break-word" }),
		Y("break-all", { wordBreak: "break-all" }),
		Y("break-keep", { wordBreak: "keep-all" }),
		zr("caret-", {
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		zr("accent-", {
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		Y("bg-gradient-to-([trbl]|[tb][rl])", "backgroundImage", ({ 1: e }) => `linear-gradient(to ${Fi(e, " ")},var(--tw-gradient-stops))`),
		zr("from-", {
			section: "gradientColorStops",
			opacityVariable: !1,
			opacitySection: "opacity"
		}, ({ _: e }) => ({
			"--tw-gradient-from": e.value,
			"--tw-gradient-to": e.color({ opacityValue: "0" }),
			"--tw-gradient-stops": "var(--tw-gradient-from),var(--tw-gradient-to)"
		})),
		zr("via-", {
			section: "gradientColorStops",
			opacityVariable: !1,
			opacitySection: "opacity"
		}, ({ _: e }) => ({
			"--tw-gradient-to": e.color({ opacityValue: "0" }),
			"--tw-gradient-stops": `var(--tw-gradient-from),${e.value},var(--tw-gradient-to)`
		})),
		zr("to-", {
			section: "gradientColorStops",
			property: "--tw-gradient-to",
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		Y("bg-(fixed|local|scroll)", "backgroundAttachment"),
		Y("bg-origin-(border|padding|content)", "backgroundOrigin", ({ 1: e }) => e + "-box"),
		Y(["bg-(no-repeat|repeat(-[xy])?)", "bg-repeat-(round|space)"], "backgroundRepeat"),
		Y("bg-blend-", "backgroundBlendMode"),
		Y("bg-clip-(border|padding|content|text)", "backgroundClip", ({ 1: e }) => e + (e == "text" ? "" : "-box")),
		X("bg-opacity-", "backgroundOpacity", "--tw-bg-opacity"),
		zr("bg-", { section: "backgroundColor" }),
		X("bg-", "backgroundImage"),
		X("bg-", "backgroundPosition"),
		Y("bg-(top|bottom|center|(left|right)(-(top|bottom))?)", "backgroundPosition", Ni),
		X("bg-", "backgroundSize"),
		X("rounded(?:$|-)", "borderRadius"),
		X("rounded-([trbl]|[tb][rl])(?:$|-)", "borderRadius", ({ 1: e, _: t }) => {
			let n = {
				t: ["tl", "tr"],
				r: ["tr", "br"],
				b: ["bl", "br"],
				l: ["bl", "tl"]
			}[e] || [e, e];
			return {
				[`border-${Fi(n[0])}-radius`]: t,
				[`border-${Fi(n[1])}-radius`]: t
			};
		}),
		Y("border-(collapse|separate)", "borderCollapse"),
		X("border-opacity(?:$|-)", "borderOpacity", "--tw-border-opacity"),
		Y("border-(solid|dashed|dotted|double|none)", "borderStyle"),
		X("border-spacing(-[xy])?(?:$|-)", "borderSpacing", ({ 1: e, _: t }) => ({
			...Gi({
				"--tw-border-spacing-x": "0",
				"--tw-border-spacing-y": "0"
			}),
			["--tw-border-spacing" + (e || "-x")]: t,
			["--tw-border-spacing" + (e || "-y")]: t,
			"border-spacing": "var(--tw-border-spacing-x) var(--tw-border-spacing-y)"
		})),
		zr("border-([xytrbl])-", { section: "borderColor" }, Ri("border", "Color")),
		zr("border-"),
		X("border-([xytrbl])(?:$|-)", "borderWidth", Ri("border", "Width")),
		X("border(?:$|-)", "borderWidth"),
		X("divide-opacity(?:$|-)", "divideOpacity", ({ _: e }) => ({ "&>:not([hidden])~:not([hidden])": { "--tw-divide-opacity": e } })),
		Y("divide-(solid|dashed|dotted|double|none)", ({ 1: e }) => ({ "&>:not([hidden])~:not([hidden])": { borderStyle: e } })),
		Y("divide-([xy]-reverse)", ({ 1: e }) => ({ "&>:not([hidden])~:not([hidden])": { ["--tw-divide-" + e]: "1" } })),
		X("divide-([xy])(?:$|-)", "divideWidth", ({ 1: e, _: t }) => {
			let n = {
				x: "lr",
				y: "tb"
			}[e];
			return { "&>:not([hidden])~:not([hidden])": {
				[`--tw-divide-${e}-reverse`]: "0",
				[`border-${Fi(n[0])}Width`]: `calc(${t} * calc(1 - var(--tw-divide-${e}-reverse)))`,
				[`border-${Fi(n[1])}Width`]: `calc(${t} * var(--tw-divide-${e}-reverse))`
			} };
		}),
		zr("divide-", {
			property: "borderColor",
			selector: "&>:not([hidden])~:not([hidden])"
		}),
		X("ring-opacity(?:$|-)", "ringOpacity", "--tw-ring-opacity"),
		zr("ring-offset-", {
			property: "--tw-ring-offset-color",
			opacityVariable: !1
		}),
		X("ring-offset(?:$|-)", "ringOffsetWidth", "--tw-ring-offset-width"),
		Y("ring-inset", { "--tw-ring-inset": "inset" }),
		zr("ring-", { property: "--tw-ring-color" }),
		X("ring(?:$|-)", "ringWidth", ({ _: e }, { theme: t }) => ({
			...Gi({
				"--tw-ring-offset-shadow": "0 0 #0000",
				"--tw-ring-shadow": "0 0 #0000",
				"--tw-shadow": "0 0 #0000",
				"--tw-shadow-colored": "0 0 #0000",
				"&": {
					"--tw-ring-inset": "var(--tw-empty,/*!*/ /*!*/)",
					"--tw-ring-offset-width": t("ringOffsetWidth", "", "0px"),
					"--tw-ring-offset-color": br(t("ringOffsetColor", "", "#fff")),
					"--tw-ring-color": br(t("ringColor", "", "#93c5fd"), { opacityVariable: "--tw-ring-opacity" }),
					"--tw-ring-opacity": t("ringOpacity", "", "0.5")
				}
			}),
			"--tw-ring-offset-shadow": "var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color)",
			"--tw-ring-shadow": `var(--tw-ring-inset) 0 0 0 calc(${e} + var(--tw-ring-offset-width)) var(--tw-ring-color)`,
			boxShadow: "var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)"
		})),
		zr("shadow-", {
			section: "boxShadowColor",
			opacityVariable: !1,
			opacitySection: "opacity"
		}, ({ _: e }) => ({
			"--tw-shadow-color": e.value,
			"--tw-shadow": "var(--tw-shadow-colored)"
		})),
		X("shadow(?:$|-)", "boxShadow", ({ _: e }) => ({
			...Gi({
				"--tw-ring-offset-shadow": "0 0 #0000",
				"--tw-ring-shadow": "0 0 #0000",
				"--tw-shadow": "0 0 #0000",
				"--tw-shadow-colored": "0 0 #0000"
			}),
			"--tw-shadow": Ii(e),
			"--tw-shadow-colored": Ii(e).replace(/([^,]\s+)(?:#[a-f\d]+|(?:(?:hsl|rgb)a?|hwb|lab|lch|color|var)\(.+?\)|[a-z]+)(,|$)/g, "$1var(--tw-shadow-color)$2"),
			boxShadow: "var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)"
		})),
		X("(opacity)-"),
		Y("mix-blend-", "mixBlendMode"),
		...zi(),
		...zi("backdrop-"),
		X("transition(?:$|-)", "transitionProperty", (e, { theme: t }) => ({
			transitionProperty: Ii(e),
			transitionTimingFunction: e._ == "none" ? void 0 : Ii(t("transitionTimingFunction", "")),
			transitionDuration: e._ == "none" ? void 0 : Ii(t("transitionDuration", ""))
		})),
		X("duration(?:$|-)", "transitionDuration", "transitionDuration", Ii),
		X("ease(?:$|-)", "transitionTimingFunction", "transitionTimingFunction", Ii),
		X("delay(?:$|-)", "transitionDelay", "transitionDelay", Ii),
		X("animate(?:$|-)", "animation", (e, { theme: t, h: n, e: r }) => {
			let i = Ii(e), a = i.split(" "), o = t("keyframes", a[0]);
			return o ? {
				["@keyframes " + (a[0] = r(n(a[0])))]: o,
				animation: a.join(" ")
			} : { animation: i };
		}),
		"(transform)-(none)",
		Y("transform", Vi),
		Y("transform-(cpu|gpu)", ({ 1: e }) => ({ "--tw-transform": Hi(e == "gpu") })),
		X("scale(-[xy])?-", "scale", ({ 1: e, _: t }) => ({
			["--tw-scale" + (e || "-x")]: t,
			["--tw-scale" + (e || "-y")]: t,
			...Vi()
		})),
		X("-?(rotate)-", "rotate", Bi),
		X("-?(translate-[xy])-", "translate", Bi),
		X("-?(skew-[xy])-", "skew", Bi),
		Y("origin-(center|((top|bottom)(-(left|right))?)|left|right)", "transformOrigin", Ni),
		"(appearance)-",
		X("(columns)-"),
		"(columns)-(\\d+)",
		"(break-(?:before|after|inside))-",
		X("(cursor)-"),
		"(cursor)-",
		Y("snap-(none)", "scroll-snap-type"),
		Y("snap-(x|y|both)", ({ 1: e }) => ({
			...Gi({ "--tw-scroll-snap-strictness": "proximity" }),
			"scroll-snap-type": e + " var(--tw-scroll-snap-strictness)"
		})),
		Y("snap-(mandatory|proximity)", "--tw-scroll-snap-strictness"),
		Y("snap-(?:(start|end|center)|align-(none))", "scroll-snap-align"),
		Y("snap-(normal|always)", "scroll-snap-stop"),
		Y("scroll-(auto|smooth)", "scroll-behavior"),
		X("scroll-p([xytrbl])?(?:$|-)", "padding", Ri("scroll-padding")),
		X("-?scroll-m([xytrbl])?(?:$|-)", "scroll-margin", Ri("scroll-margin")),
		Y("touch-(auto|none|manipulation)", "touch-action"),
		Y("touch-(pinch-zoom|pan-(?:(x|left|right)|(y|up|down)))", ({ 1: e, 2: t, 3: n }) => ({
			...Gi({
				"--tw-pan-x": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-pan-y": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-pinch-zoom": "var(--tw-empty,/*!*/ /*!*/)",
				"--tw-touch-action": "var(--tw-pan-x) var(--tw-pan-y) var(--tw-pinch-zoom)"
			}),
			[`--tw-${t ? "pan-x" : n ? "pan-y" : e}`]: e,
			"touch-action": "var(--tw-touch-action)"
		})),
		Y("outline-none", {
			outline: "2px solid transparent",
			"outline-offset": "2px"
		}),
		Y("outline", { outlineStyle: "solid" }),
		Y("outline-(dashed|dotted|double)", "outlineStyle"),
		X("-?(outline-offset)-"),
		zr("outline-", {
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		X("outline-", "outlineWidth"),
		"(pointer-events)-",
		X("(will-change)-"),
		"(will-change)-",
		[
			"resize(?:-(none|x|y))?",
			"resize",
			({ 1: e }) => ({
				x: "horizontal",
				y: "vertical"
			})[e] || e || "both"
		],
		Y("select-(none|text|all|auto)", "userSelect"),
		zr("fill-", {
			section: "fill",
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		zr("stroke-", {
			section: "stroke",
			opacityVariable: !1,
			opacitySection: "opacity"
		}),
		X("stroke-", "strokeWidth"),
		Y("sr-only", {
			position: "absolute",
			width: "1px",
			height: "1px",
			padding: "0",
			margin: "-1px",
			overflow: "hidden",
			whiteSpace: "nowrap",
			clip: "rect(0,0,0,0)",
			borderWidth: "0"
		}),
		Y("not-sr-only", {
			position: "static",
			width: "auto",
			height: "auto",
			padding: "0",
			margin: "0",
			overflow: "visible",
			whiteSpace: "normal",
			clip: "auto"
		})
	];
})), Ji, Yi = t((() => {
	_i(), Ji = [
		["sticky", "@supports ((position: -webkit-sticky) or (position:sticky))"],
		["motion-reduce", "@media (prefers-reduced-motion:reduce)"],
		["motion-safe", "@media (prefers-reduced-motion:no-preference)"],
		["print", "@media print"],
		["(portrait|landscape)", ({ 1: e }) => `@media (orientation:${e})`],
		["contrast-(more|less)", ({ 1: e }) => `@media (prefers-contrast:${e})`],
		["(first-(letter|line)|placeholder|backdrop|before|after)", ({ 1: e }) => `&::${e}`],
		["(marker|selection)", ({ 1: e }) => `& *::${e},&::${e}`],
		["file", "&::file-selector-button"],
		["(first|last|only)", ({ 1: e }) => `&:${e}-child`],
		["even", "&:nth-child(2n)"],
		["odd", "&:nth-child(odd)"],
		["open", "&[open]"],
		["(aria|data)-", ({ 1: e, $$: t }, n) => t && `&[${e}-${n.theme(e, t) || Ur(t, "", n) || `${t}="true"`}]`],
		["((group|peer)(~[^-[]+)?)(-\\[(.+)]|[-[].+?)(\\/.+)?", ({ 2: e, 3: t = "", 4: n, 5: r = "", 6: i = t }, { e: a, h: o, v: s }) => {
			let c = Gr(r) || (n[0] == "[" ? n : s(n.slice(1)));
			return `${(c.includes("&") ? c : "&" + c).replace(/&/g, `:merge(.${a(o(e + i))})`)}${e[0] == "p" ? "~" : " "}&`;
		}],
		["(ltr|rtl)", ({ 1: e }) => `[dir="${e}"] &`],
		["supports-", ({ $$: e }, t) => {
			if (e &&= t.theme("supports", e) || Ur(e, "", t), e) return e.includes(":") || (e += ":var(--tw)"), /^\w*\s*\(/.test(e) || (e = `(${e})`), `@supports ${e.replace(/\b(and|or|not)\b/g, " $1 ").trim()}`;
		}],
		["max-", ({ $$: e }, t) => {
			if (e &&= t.theme("screens", e) || Ur(e, "", t), typeof e == "string") return `@media not all and (min-width:${e})`;
		}],
		["min-", ({ $$: e }, t) => (e &&= Ur(e, "", t), e && `@media (min-width:${e})`)],
		[/^\[(.+)]$/, ({ 1: e }) => /[&@]/.test(e) && Gr(e).replace(/[}]+$/, "").split("{")]
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/@twind+preset-tailwind@1.1.4_@twind+core@1.1.3_typescript@5.9.2__typescript@5.9.2/node_modules/@twind/preset-tailwind/base.js
function Xi({ colors: e, disablePreflight: t } = {}) {
	return {
		preflight: t ? void 0 : ji,
		theme: {
			...ki,
			colors: {
				inherit: "inherit",
				current: "currentColor",
				transparent: "transparent",
				black: "#000",
				white: "#fff",
				...e
			}
		},
		variants: Ji,
		rules: Ki,
		finalize(e) {
			return e.n && e.d && e.r.some((e) => /^&::(before|after)$/.test(e)) && !/(^|;)content:/.test(e.d) ? {
				...e,
				d: "content:var(--tw-content);" + e.d
			} : e;
		}
	};
}
var Zi = t((() => {
	Ai(), Mi(), qi(), Yi();
})), Qi, Q, $i, ea = t((() => {
	_i(), Ti(), Zi(), Qi = ei(qr({
		preflight: !1,
		hash: !0,
		darkMode: "class",
		theme: { extend: {
			colors: {
				background: "var(--swk-background)",
				"background-secondary": "var(--swk-background-secondary)",
				"foreground-strong": "var(--swk-foreground-strong)",
				foreground: "var(--swk-foreground)",
				"foreground-secondary": "var(--swk-foreground-secondary)",
				primary: "var(--swk-primary)",
				"primary-foreground": "var(--swk-primary-foreground)",
				transparent: "var(--swk-transparent)",
				lighter: "var(--swk-lighter)",
				light: "var(--swk-light)",
				"light-gray": "var(--swk-light-gray)",
				gray: "var(--swk-gray)",
				danger: "var(--swk-danger)",
				border: "var(--swk-border)"
			},
			boxShadow: { default: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)" },
			borderRadius: { default: "var(--swk-border-radius)" },
			fontFamily: { default: "var(--swk-font-family)" }
		} },
		presets: [Ci(), Xi({ disablePreflight: !0 })]
	}), typeof document > "u" ? ri() : ni("style[data-library]")), Q = (e) => Qi(`!(${e})`), gi.bind(Qi), mi.bind(Qi), hi.bind(Qi), $i = Fr`
  .stellar-wallets-kit *,
  .stellar-wallets-kit ::after,
  .stellar-wallets-kit ::before,
  .stellar-wallets-kit ::backdrop,
  .stellar-wallets-kit ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid;
  }
  .stellar-wallets-kit :host {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    font-family:
      ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
      "Noto Color Emoji";
    font-feature-settings: normal;
    font-variation-settings: normal;
    -webkit-tap-highlight-color: transparent;
  }
  .stellar-wallets-kit hr {
    height: 0;
    color: inherit;
    border-top-width: 1px;
  }
  .stellar-wallets-kit abbr:where([title]) {
    -webkit-text-decoration: underline dotted;
    text-decoration: underline dotted;
  }
  .stellar-wallets-kit h1,
  .stellar-wallets-kit h2,
  .stellar-wallets-kit h3,
  .stellar-wallets-kit h4,
  .stellar-wallets-kit h5,
  .stellar-wallets-kit h6 {
    font-size: inherit;
    font-weight: inherit;
  }
  .stellar-wallets-kit a {
    color: inherit;
    -webkit-text-decoration: inherit;
    text-decoration: inherit;
  }
  .stellar-wallets-kit b,
  .stellar-wallets-kit strong {
    font-weight: bolder;
  }
  .stellar-wallets-kit code,
  .stellar-wallets-kit kbd,
  .stellar-wallets-kit samp,
  .stellar-wallets-kit pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-feature-settings: normal;
    font-variation-settings: normal;
    font-size: 1em;
  }
  .stellar-wallets-kit small {
    font-size: 80%;
  }
  .stellar-wallets-kit sub,
  .stellar-wallets-kit sup {
    font-size: 75%;
    line-height: 0;
    position: relative;
    vertical-align: baseline;
  }
  .stellar-wallets-kit sub {
    bottom: -0.25em;
  }
  .stellar-wallets-kit sup {
    top: -0.5em;
  }
  .stellar-wallets-kit table {
    text-indent: 0;
    border-color: inherit;
    border-collapse: collapse;
  }
  .stellar-wallets-kit :-moz-focusring {
    outline: auto;
  }
  .stellar-wallets-kit progress {
    vertical-align: baseline;
  }
  .stellar-wallets-kit summary {
    display: list-item;
  }
  .stellar-wallets-kit ol,
  .stellar-wallets-kit ul,
  .stellar-wallets-kit menu {
    list-style: none;
  }
  .stellar-wallets-kit img,
  .stellar-wallets-kit svg,
  .stellar-wallets-kit video,
  .stellar-wallets-kit canvas,
  .stellar-wallets-kit audio,
  .stellar-wallets-kit iframe,
  .stellar-wallets-kit embed,
  .stellar-wallets-kit object {
    display: block;
    vertical-align: middle;
  }
  .stellar-wallets-kit img,
  .stellar-wallets-kit video {
    max-width: 100%;
    height: auto;
  }
  .stellar-wallets-kit button,
  .stellar-wallets-kit input,
  .stellar-wallets-kit select,
  .stellar-wallets-kit optgroup,
  .stellar-wallets-kit textarea,
  .stellar-wallets-kit ::file-selector-button {
    font: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    letter-spacing: inherit;
    color: inherit;
    border-radius: 0;
    background-color: transparent;
    opacity: 1;
  }
  .stellar-wallets-kit :where(select:is([multiple], [size])) optgroup {
    font-weight: bolder;
  }
  .stellar-wallets-kit :where(select:is([multiple], [size])) optgroup option {
    padding-inline-start: 20px;
  }
  .stellar-wallets-kit ::file-selector-button {
    margin-inline-end: 4px;
  }
  .stellar-wallets-kit ::placeholder {
    opacity: 1;
  }
  .stellar-wallets-kit textarea {
    resize: vertical;
  }
  .stellar-wallets-kit ::-webkit-search-decoration {
    -webkit-appearance: none;
  }
  .stellar-wallets-kit ::-webkit-date-and-time-value {
    min-height: 1lh;
    text-align: inherit;
  }
  .stellar-wallets-kit ::-webkit-datetime-edit {
    display: inline-flex;
  }
  .stellar-wallets-kit ::-webkit-datetime-edit-fields-wrapper {
    padding: 0;
  }
  .stellar-wallets-kit ::-webkit-datetime-edit,
  .stellar-wallets-kit ::-webkit-datetime-edit-year-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-month-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-day-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-hour-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-minute-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-second-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-millisecond-field,
  .stellar-wallets-kit ::-webkit-datetime-edit-meridiem-field {
    padding-block: 0;
  }
  .stellar-wallets-kit ::-webkit-calendar-picker-indicator {
    line-height: 1;
  }
  .stellar-wallets-kit :-moz-ui-invalid {
    box-shadow: none;
  }
  .stellar-wallets-kit button,
  .stellar-wallets-kit input:where([type="button"], [type="reset"], [type="submit"]),
  .stellar-wallets-kit ::file-selector-button {
    appearance: button;
  }
  .stellar-wallets-kit ::-webkit-inner-spin-button,
  .stellar-wallets-kit ::-webkit-outer-spin-button {
    height: auto;
  }
  .stellar-wallets-kit [hidden]:where(:not([hidden="until-found"])) {
    display: none !important;
  }
`;
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/shared/button.js
function ta({ size: e = na.md, mode: t = ra.primary, shape: n = ia.regular, classes: r, styles: i, children: a, onClick: o }) {
	let s = Kr({
		"border-none bg-primary text-primary-foreground shadow-default hover:opacity-70 focus:opacity-90": t === ra.primary,
		"border-none bg-background text-foreground shadow-default hover:opacity-70 focus:opacity-90": t === ra.secondary,
		"bg-transparent text-foreground border-transparent border-1 hover:border-light-gray": t === ra.ghost
	}), c = Kr({
		"rounded-default": n === ia.regular,
		"rounded-full": n === ia.icon
	}), l = Kr({
		"text-xs": e === na.xs,
		"text-sm": e !== na.xs
	}), u = Kr({
		"px-2 py-1": n === ia.regular && (e === na.xs || e === na.sm),
		"px-2.5 py-1.5": n === ia.regular && e === na.md,
		"px-3 py-2": n === ia.regular && e === na.lg,
		"px-3.5 py-2.5": n === ia.regular && e === na.xl,
		"p-1": n === ia.icon && e === na.xs,
		"p-1.5": n === ia.icon && e === na.sm,
		"p-2": n === ia.icon && e === na.md,
		"p-2.5": n === ia.icon && e === na.lg,
		"p-3": n === ia.icon && e === na.xl
	});
	return vn`
    <button onClick="${() => o()}" type="button" style="${i}" class="${t === ra.free ? "" : Q(Kr("cursor-pointer", aa, s, c, l, u))} ${r}">
      ${a}
    </button>
  `;
}
var na, ra, ia, aa, oa = t((() => {
	yn(), ea(), na = /*#__PURE__*/ function(e) {
		return e.xs = "xs", e.sm = "sm", e.md = "md", e.lg = "lg", e.xl = "xl", e;
	}({}), ra = /*#__PURE__*/ function(e) {
		return e.primary = "primary", e.secondary = "secondary", e.ghost = "ghost", e.free = "free", e;
	}({}), ia = /*#__PURE__*/ function(e) {
		return e.regular = "regular", e.icon = "icon", e;
	}({}), aa = "flex items-center justify-center font-semibold easy-in-out transition leading-none";
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/router.js
function sa() {
	jn.value = [];
}
function ca(e) {
	An.value = e, jn.value = [...jn.value, e];
}
function la() {
	let e = jn.value;
	e.pop(), jn.value = e.slice(), An.value = e[e.length - 1];
}
function ua({ children: e, isActive: t, duration: n = 300 }) {
	let [r, i] = nt(t), [a, o] = nt(t);
	return it(() => {
		if (t) o(!0), globalThis.requestAnimationFrame(() => i(!0));
		else {
			i(!1);
			let e = globalThis.setTimeout(() => o(!1), n);
			return () => globalThis.clearTimeout(e);
		}
	}, [t, n]), a ? vn`<div style=${{
		position: r ? "relative" : "absolute",
		inset: 0,
		transition: `opacity ${n}ms ease, transform ${n}ms ease, position ${n}ms ease`,
		opacity: +!!r
	}}>${e}</div>` : null;
}
function da({ currentRoute: e, pages: t, duration: n = 300 }) {
	return vn`<div style=${{
		position: "relative",
		width: "100%",
		height: "100%"
	}}>${Object.entries(t).map(([t, r]) => vn`
      <${ua} id=${t} key=${t} isActive=${e === t} duration=${n}>
        <${r} />
      <//>
    `)}</div>`;
}
var fa = t((() => {
	tr(), yn(), Et();
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/shared/header.js
function pa() {
	ca(z.HELP_PAGE);
}
function ma() {
	la();
}
function ha() {
	return vn`
    <header class="${Q("flex items-center px-3 py-2")}">
      <div class="${Q("w-3/12 flex justify-start")}">
        ${ga.value}
      </div>

      <div class="${Q("w-6/12 text-center")}">
        <h1 class="${Q("text-foreground-strong font-semibold")}">
          ${Cn.value}
        </h1>
      </div>

      <div class="${Q("w-3/12 flex justify-end")}">
        <${ta} onClick=${() => Kn.next()}
                   size="${na.md}"
                   mode="${ra.ghost}"
                   shape="${ia.icon}">

          <svg class="${Q("w-4 h-4")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"></path></svg>
        <//>
      </div>
    </header>
  `;
}
var ga, _a = t((() => {
	yn(), tr(), pn(), q(), oa(), fa(), ea(), ga = Lt(() => An.value === z.AUTH_OPTIONS ? vn`
      <${ta} onClick=${() => pa()}
                 size="${na.md}"
                 mode="${ra.ghost}"
                 shape="${ia.icon}">
        <svg class="${Q("w-4 h-4")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 15H13V17H11V15ZM13 13.3551V14H11V12.5C11 11.9477 11.4477 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.2723 8.5 10.6656 9.01823 10.5288 9.70577L8.56731 9.31346C8.88637 7.70919 10.302 6.5 12 6.5C13.933 6.5 15.5 8.067 15.5 10C15.5 11.5855 14.4457 12.9248 13 13.3551Z"></path></svg>
      <//>
    ` : jn.value.length < 2 ? vn`` : vn`
      <${ta} onClick=${() => ma()}
                 size="${na.md}"
                 mode="${ra.ghost}"
                 shape="${ia.icon}">
        
        <svg class="${Q("w-4 h-4")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M7.82843 10.9999H20V12.9999H7.82843L13.1924 18.3638L11.7782 19.778L4 11.9999L11.7782 4.22168L13.1924 5.63589L7.82843 10.9999Z"></path></svg>
      <//>
    `);
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/shared/footer.js
function va() {
	return vn`
    <footer class="${Q("w-full text-center p-2 border-t-1 border-t-border")}">
      <p class="${Q("text-xs text-foreground")}">
        Powered by
        <a target="_blank" href="https://stellarwalletskit.dev/" class="${Q("font-semibold underline ml-1")}">
          Stellar Wallets Kit
        </a>
      </p>
    </footer>
  `;
}
var ya = t((() => {
	yn(), ea();
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/shared/avatar.js
function ba(e) {
	return vn`
    <img alt="${e.alt}" src="${e.image}" class="${Q(Kr(Sa, e.size))}" />
  `;
}
var xa, Sa, Ca = t((() => {
	yn(), ea(), xa = /*#__PURE__*/ function(e) {
		return e.xs = "w-6 h-6", e.sm = "w-8 h-8", e.md = "w-10 h-10", e.lg = "w-12 h-12", e.xl = "w-14 h-14", e;
	}({}), Sa = "inline-block rounded-full outline -outline-offset-1 outline-black/5 dark:outline-white/10";
})), wa = t((() => {
	_a(), ya(), Ca(), oa();
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/pages/auth-options.page.js
async function Ta(e) {
	if (!e.isAvailable) {
		globalThis.open(e.url, "_blank");
		return;
	}
	if (Nn.value = e.id, Wn.next(e), e.type === K.HW_WALLET) ca(z.HW_ACCOUNTS_FETCHER);
	else try {
		let { address: e } = await In.value.getAddress();
		Mn.value = e, Gn.next(e);
	} catch (e) {
		Gn.next(e);
	}
}
function Ea() {
	Cn.value = "Connect Wallet";
	let e = Da.value.find((e) => e.isPlatformWrapper);
	if (e) return Ta(e).then(), vn`
      <div class="${Q("w-full text-center px-4 py-8")}">
        <div class="${Q("w-full mb-4")}">
          <${ba} alt="${e.name} icon" image="${e.icon}" size="${xa.md}" />
        </div>

        <p class="${Q("text-foreground text-lg w-full")}">
          Connecting to your wallet using <b>${e.name}</b>
        </p>
      </div>
    `;
	let t = vn`
    <div class="${Q("w-full text-center text-foreground font-semibold p-4")}">Loading wallets...</div>
  `, n = Da.value.map((e) => vn`
      <li
        onClick="${() => Ta(e)}"
        class="${Q("px-2 py-2 cursor-pointer flex justify-between items-center bg-background hover:border-light-gray border-1 border-transparent rounded-default duration-150 ease active:bg-background active:border-gray")}"
      >
        <div class="${Q("flex items-center gap-2")}">
          <${ba} class="${Q("mr-2")}" alt="${e.name} icon" image="${e.icon}" size="${xa.sm}" />
          <p class="${Q("text-foreground font-semibold")}">${e.name}</p>
        </div>

        ${wn.value && !e.isAvailable ? vn`
            <div class="${Q("ml-4 flex items-center")}">
              <small
                class="${Q("inline-flex items-center border-1 border-border px-2 py-1 rounded-default text-foreground-secondary text-xs bg-background-secondary")}"
              >
                ${En.value}

                <svg class="${Q("w-4 h-4")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.0037 9.41421L7.39712 18.0208L5.98291 16.6066L14.5895 8H7.00373V6H18.0037V17H16.0037V9.41421Z"></path>
                </svg>
              </small>
            </div>
          ` : ""}
      </li>
    `);
	return vn`
    <ul class="${Q("w-full grid gap-2 px-2 py-4")}">
      ${Da.value.length === 0 ? t : n}
    </ul>
  `;
}
var Da, Oa = t((() => {
	yn(), tr(), pn(), q(), Ca(), ea(), fa(), Da = Lt(() => {
		let e = Pn.value.reduce((e, t) => ({
			available: t.isAvailable ? [...e.available, t] : e.available,
			unavailable: t.isAvailable ? e.unavailable : [...e.unavailable, t]
		}), {
			available: [],
			unavailable: []
		}), t;
		try {
			let e = globalThis?.localStorage.getItem(W.usedWalletsIds);
			t = e ? JSON.parse(e) : [];
		} catch (e) {
			console.error(e), t = [];
		}
		let n = [], r = [];
		for (let i of e.available) t.find((e) => e === i.id) ? n.push(i) : r.push(i);
		return [
			...n.sort((e, n) => t.indexOf(e.id) - t.indexOf(n.id)),
			...r,
			...e.unavailable
		];
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/pages/what-is-a-wallet.page.js
function ka() {
	return vn`
    <section class="${Q("w-full p-4 pb-8 rounded-tl-default")}">
      <div class="${Q("w-full mb-6")}">
        <h3 class="${Q("text-foreground-strong font-semibold text-lg mb-2")}">What is a wallet?</h3>
        <p class="${Q("text-foreground text-sm")}">
          Wallets are used to send, receive, and store the keys you use to sign blockchain transactions.
        </p>
      </div>

      <div class="w-full">
        <h3 class="${Q("text-foreground-strong font-semibold text-lg mb-2")}">What is Stellar?</h3>
        <p class="${Q("text-foreground text-sm")}">
          Stellar is a decentralized, public blockchain that gives developers the tools to create experiences that are more
          like cash than crypto.
        </p>
      </div>
    </section>
  `;
}
var Aa = t((() => {
	yn(), ea();
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/sdk/utils.js
function $(e) {
	return {
		code: e?.error?.code || e?.code || -1,
		message: e?.error?.message || e?.message || typeof e == "string" && e || "Unhandled error from the wallet",
		ext: e?.error?.ext || e?.ext
	};
}
function ja() {
	In.value?.disconnect && In.value.disconnect(), bn(), qn.next(), Kn.next();
}
var Ma = t((() => {
	Hn(), Jn();
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/pages/profile.page.js
function Na() {
	if (!Mn.value) throw Error("Text to copy to the clipboard can't be undefined");
	navigator.clipboard.writeText(Mn.value).then(() => {
		Fa.value = !0, setTimeout(() => {
			Fa.value = !1;
		}, 2500);
	}).catch((e) => console.error(e));
}
function Pa() {
	return Cn.value = "", vn`
    <section class="${Q("w-full flex flex-col pb-8")}">
      <div class="${Q("w-full flex justify-center mb-4")}">
        <${ba} alt="${In.value?.productName} icon" image="${In.value?.productIcon}" size="${xa.xl}" />
      </div>
      
      <div class="${Q("w-full flex items-center justify-center mb-2")}">
        <h1 class="${Q("text-lg font-semibold text-foreground")}">
          ${Mn.value && `${Mn.value.slice(0, 6)}....${Mn.value.slice(-6)}`}
        </h1>
      </div>
      
      <div class="${Q("w-full flex flex-col items-center justify-center gap-2")}">
        <${ta} mode="${ra.ghost}" onClick="${Na}" size="${na.sm}">
          ${Fa.value ? "Address copied!" : vn`Copy address`} <svg class="${Q("w-4 h-4 ml-2")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6.9998 6V3C6.9998 2.44772 7.44752 2 7.9998 2H19.9998C20.5521 2 20.9998 2.44772 20.9998 3V17C20.9998 17.5523 20.5521 18 19.9998 18H16.9998V20.9991C16.9998 21.5519 16.5499 22 15.993 22H4.00666C3.45059 22 3 21.5554 3 20.9991L3.0026 7.00087C3.0027 6.44811 3.45264 6 4.00942 6H6.9998ZM5.00242 8L5.00019 20H14.9998V8H5.00242ZM8.9998 6H16.9998V16H18.9998V4H8.9998V6Z"></path></svg>
        <//>

        <${ta} mode="${ra.ghost}" onClick="${ja}" size="${na.sm}">
          Disconnect <svg class="${Q("w-4 h-4 ml-2")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 11H13V13H5V16L0 12L5 8V11ZM3.99927 18H6.70835C8.11862 19.2447 9.97111 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.97111 4 8.11862 4.75527 6.70835 6H3.99927C5.82368 3.57111 8.72836 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C8.72836 22 5.82368 20.4289 3.99927 18Z"></path></svg>
        <//>
      </div>
    </section>
  `;
}
var Fa, Ia = t((() => {
	yn(), ea(), Hn(), oa(), Ca(), pn(), Ma(), Fa = Mt(!1);
})), La, Ra, za = t((() => {
	et(), pn(), yn(), Hn(), ea(), oa(), Jn(), La = {
		error: null,
		loading: !0,
		accounts: []
	}, Ra = class extends me {
		stateSignal = Mt(La);
		componentWillMount() {
			Cn.value = "Wallet Accounts", this.fetchAccounts();
		}
		async fetchAccounts() {
			let e = In.value;
			this.stateSignal.value = La, e.disconnect && (await e.disconnect(), await new Promise((e) => setTimeout(e, 500)));
			try {
				let t = await e.getAddresses();
				this.stateSignal.value = {
					...this.stateSignal.value,
					loading: !1,
					accounts: t
				};
			} catch (e) {
				this.stateSignal.value = {
					...this.stateSignal.value,
					error: e.message
				};
			}
		}
		async selectAccount(e) {
			Mn.value = e.publicKey, Gn.next(e.publicKey);
		}
		render() {
			let e = vn`
      <div class="${Q("py-8 w-full flex justify-center items-center text-foreground")}">
        <svg class="${Q("w-8 h-8 text-gray-200 animate-spin")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C16.9706 3 21 7.02944 21 12H19C19 8.13401 15.866 5 12 5V3Z"></path>
        </svg>
      </div>
    `, t = vn`    
      <ul class="${Q("w-full grid gap-2 px-2 py-4 text-foreground")}">
        ${Rn.value.map(({ publicKey: e, index: t }) => vn`
            <li onClick=${() => this.selectAccount({
				publicKey: e,
				index: t
			})}
                class="${Q("px-2 py-2 cursor-pointer flex justify-between items-center bg-background hover:border-light-gray border-1 border-transparent rounded-default duration-150 ease active:bg-background active:border-gray")}">
              ${e.slice(0, 6)}....${e.slice(-6)}

              <span class="dialog-text">(44'/148'/${t}')</span>
            </li>
          `)}
      </ul>
    `, n = vn`
      <div class="${Q("w-full text-center text-foreground py-4")}">
        <div class="${Q("text-danger")}">
          <svg class="${Q("inline-block mx-auto w-8 h-8 mb-2")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.8659 3.00017L22.3922 19.5002C22.6684 19.9785 22.5045 20.5901 22.0262 20.8662C21.8742 20.954 21.7017 21.0002 21.5262 21.0002H2.47363C1.92135 21.0002 1.47363 20.5525 1.47363 20.0002C1.47363 19.8246 1.51984 19.6522 1.60761 19.5002L11.1339 3.00017C11.41 2.52187 12.0216 2.358 12.4999 2.63414C12.6519 2.72191 12.7782 2.84815 12.8659 3.00017ZM4.20568 19.0002H19.7941L11.9999 5.50017L4.20568 19.0002ZM10.9999 16.0002H12.9999V18.0002H10.9999V16.0002ZM10.9999 9.00017H12.9999V14.0002H10.9999V9.00017Z"></path>
          </svg>
        </div>
        
        <h3 class="${Q("text-sm font-semibold")}">
          Error while fetching accounts with reason:
        </h3>
        
        <p class="${Q("mb-4 text-sm")}">
          ${this.stateSignal.value.error}
        </p>
        
        <div class="${Q("w-full flex justify-center items-center")}">
          <${ta} onClick=${() => this.fetchAccounts()} size="${na.md}">
            Retry
          <//>
        </div>
      </div>
    `;
			return this.stateSignal.value.error ? n : this.stateSignal.value.loading ? e : t;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/app.js
function Ba() {
	return vn`
    <section class="stellar-wallets-kit ${Q(Kr([Sn.value === B.FIXED ? "fixed flex left-0 top-0 z-[999] w-full h-full" : "inline-flex", "font-default justify-center items-center"]))} ${Q($i)} ${Q(Ha)}">
      ${Sn.value === B.FIXED ? vn`
          <div class="${Q("absolute left-0 top-0 z-0 w-full h-full bg-[rgba(0,0,0,0.5)]")}" onClick="${() => Kn.next()}"></div>
        ` : ""}

      <section
        class="${Q("w-full h-fit relative max-w-[22rem] max-h-[39.4375rem] grid grid-cols-1 grid-rows-[auto_1fr_auto] bg-background rounded-default shadow-default transition-all duration-[0.5s] ease-in-out overflow-hidden max-h-[400px] overflow-y-scroll")}"
      >
        <div class="${Q("col-span-1 top-0 sticky z-50")} glass">
          <${ha} />
        </div>

        <div class="${Q("col-span-1 relative z-10")}">
          <${da}
            currentRoute="${An.value}"
            pages="${Va}"
            duration="${400}"
          />
        </div>

        <div class="${Q("col-span-1 bottom-0 sticky z-50")} glass">
          <${va} />
        </div>
      </section>
    </section>
  `;
}
var Va, Ha, Ua = t((() => {
	ea(), _i(), yn(), _a(), ya(), tr(), q(), Oa(), Aa(), fa(), Ia(), za(), Va = {
		[z.AUTH_OPTIONS]: Ea,
		[z.HELP_PAGE]: ka,
		[z.PROFILE_PAGE]: Pa,
		[z.HW_ACCOUNTS_FETCHER]: Ra
	}, Ha = Fr`
  .glass {
    backdrop-filter: blur(10px);
    background-color: color-mix(in srgb, var(--swk-background) 25%, transparent);
  }
`;
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/components/kit-button.js
async function Wa(e) {
	if (e && e(), Fn.value === void 0) throw Error("The kit hasn't been initiated.");
	!In.value || !Mn.value ? await Ja.authModal() : await Ja.profileModal();
}
function Ga(e) {
	let t = Mn.value ? `${Mn.value.slice(0, 4)}....${Mn.value.slice(-6)}` : "Connect Wallet";
	return vn`
    <div class="${Q($i)} ${Q("inline-block")}">      
      <${ta} styles=${e.styles} 
                 classes=${e.classes}
                 mode=${e.mode || ra.primary}
                 shape=${e.shape || ia.regular}
                 size=${e.size}
                 onClick=${() => Wa(e.onClick)}>        
        ${e.children ? e.children : t}
      <//>
    </div>
  `;
}
var Ka = t((() => {
	ea(), yn(), wa(), tr(), Ya();
})), qa = t((() => {
	wa(), Ua(), Ka(), fa();
})), Ja, Ya = t((() => {
	pn(), yn(), et(), q(), tr(), qa(), Ma(), fa(), Ja = class e {
		static init(t) {
			Fn.value = t.modules, t.selectedWalletId && e.setWallet(t.selectedWalletId), t.network && e.setNetwork(t.network), t.theme && e.setTheme(t.theme), t.authModal && (t.authModal.showInstallLabel !== void 0 && (wn.value = t.authModal.showInstallLabel), t.authModal.hideUnsupportedWallets !== void 0 && (Tn.value = t.authModal.hideUnsupportedWallets));
		}
		static get selectedModule() {
			if (!In.value) throw {
				code: -3,
				message: "Please set the wallet first"
			};
			return In.value;
		}
		static setWallet(e) {
			let t = Fn.value.find((t) => t.productId === e);
			if (!t) throw Error(`Wallet id "${e}" is not and existing module`);
			Nn.value = t.productId;
		}
		static setNetwork(e) {
			On.value = e;
		}
		static setTheme(e = V) {
			kn.value = e;
		}
		static async getAddress() {
			if (!Mn.value) throw {
				code: -1,
				message: "No wallet has been connected."
			};
			return { address: Mn.value };
		}
		static async fetchAddress() {
			let { address: t } = await e.selectedModule.getAddress();
			return Mn.value = t, Gn.next(t), { address: t };
		}
		static signTransaction(t, n) {
			return e.selectedModule.signTransaction(t, {
				...n,
				networkPassphrase: n?.networkPassphrase || On.value
			});
		}
		static signAuthEntry(t, n) {
			return e.selectedModule.signAuthEntry(t, {
				...n,
				networkPassphrase: n?.networkPassphrase || On.value
			});
		}
		static signMessage(t, n) {
			return e.selectedModule.signMessage(t, {
				...n,
				networkPassphrase: n?.networkPassphrase || On.value
			});
		}
		static signAndSubmitTransaction(t, n) {
			let r = e.selectedModule;
			if (!r.signAndSubmitTransaction) throw {
				code: -3,
				message: `The selected module "${r.productName}" does not support the "signAndSubmitTransaction" method.`
			};
			return r.signAndSubmitTransaction(t, {
				...n,
				networkPassphrase: n?.networkPassphrase || On.value
			});
		}
		static getNetwork() {
			return e.selectedModule.getNetwork();
		}
		static async disconnect() {
			ja();
		}
		static on(e, t) {
			switch (e) {
				case ne.STATE_UPDATED: {
					let e, n;
					return Ht(() => {
						(Mn.value !== e || On.value !== n) && (e = Mn.value, n = On.value, t({
							eventType: ne.STATE_UPDATED,
							payload: {
								address: Mn.value,
								networkPassphrase: On.value
							}
						}));
					});
				}
				case ne.WALLET_SELECTED: {
					let e;
					return Ht(() => {
						Nn.value !== e && (e = Nn.value, t({
							eventType: ne.WALLET_SELECTED,
							payload: { id: Nn.value }
						}));
					});
				}
				case ne.DISCONNECT: return qn.subscribe(() => {
					t({
						eventType: ne.DISCONNECT,
						payload: {}
					});
				});
				default: throw Error(`${e} event type is not supported`);
			}
		}
		static async refreshSupportedWallets() {
			let e = await Promise.all(Fn.value.map(async (e) => {
				let t = new Promise((e) => setTimeout(() => e(!1), 1e3));
				return {
					id: e.productId,
					name: e.productName,
					type: e.moduleType,
					icon: e.productIcon,
					isAvailable: await Promise.race([t, e.isAvailable()]).catch(() => !1),
					isPlatformWrapper: await Promise.race([t, e.isPlatformWrapper ? e.isPlatformWrapper() : Promise.resolve(!1)]).catch(() => !1),
					url: e.productUrl
				};
			}));
			return Pn.value = e, e;
		}
		static async createButton(e, t = {}) {
			Fe(vn`
        <${Ga}
          styles="${t.styles}"
          classes="${t.classes}"
          mode="${t.mode}"
          shape="${t.shape}"
          size="${t.size}"
          onClick="${() => t.onClick && t.onClick()}"
          children="${t.children}"
        />
      `, e);
		}
		static async authModal(t) {
			sa(), ca(z.AUTH_OPTIONS), Sn.value = t?.container ? B.BLOCK : B.FIXED;
			let n = document.createElement("div");
			(t?.container || document.body).appendChild(n), Fe(vn`
        <${Ba} />
      `, n), await e.refreshSupportedWallets();
			let r = [], i = () => {
				for (let e of r) e();
				Fe(null, n), n.parentNode?.removeChild(n);
			};
			return new Promise((e, t) => {
				let n = Gn.subscribe((n) => {
					typeof n == "string" ? e({ address: n }) : t($(n));
				}), i = Kn.subscribe(() => {
					t({
						code: -1,
						message: "The user closed the modal."
					});
				});
				r.push(n), r.push(i);
			}).then((e) => (i(), e)).catch((e) => {
				throw i(), e;
			});
		}
		static async profileModal(e) {
			if (!Mn.value) throw {
				code: -1,
				message: "There is no active address, the user needs to authenticate first."
			};
			sa(), ca(z.PROFILE_PAGE), Sn.value = e?.container ? B.BLOCK : B.FIXED;
			let t = document.createElement("div");
			(e?.container || document.body).appendChild(t), Fe(vn`
        <${Ba} />
      `, t);
			let n = Kn.subscribe(() => {
				n(), Fe(null, t), t.parentNode?.removeChild(t);
			});
		}
	};
})), Xa = t((() => {
	Ya(), Ma();
})), Za = /* @__PURE__ */ r({
	Avatar: () => ba,
	AvatarSize: () => xa,
	Button: () => ta,
	ButtonMode: () => ra,
	ButtonShape: () => ia,
	ButtonSize: () => na,
	Footer: () => va,
	Header: () => ha,
	KitEventType: () => ne,
	LocalStorageKeys: () => W,
	ModuleType: () => K,
	Networks: () => G,
	StellarWalletsKit: () => Ja,
	SwkApp: () => Ba,
	SwkAppDarkTheme: () => H,
	SwkAppLightTheme: () => V,
	SwkAppMode: () => B,
	SwkAppRoute: () => z,
	SwkButton: () => Ga,
	activeAddress: () => Mn,
	activeModule: () => In,
	activeModules: () => Fn,
	addressUpdatedEvent: () => Gn,
	allowedWallets: () => Pn,
	closeEvent: () => Kn,
	createSubject: () => Un,
	disconnect: () => ja,
	disconnectEvent: () => qn,
	goBack: () => la,
	hardwareWalletPaths: () => Rn,
	hideUnsupportedWallets: () => Tn,
	horizonUrl: () => Dn,
	installText: () => En,
	mnemonicPath: () => zn,
	modalTitle: () => Cn,
	mode: () => Sn,
	moduleSelectedEvent: () => Wn,
	navigateTo: () => ca,
	parseError: () => $,
	resetWalletState: () => bn,
	route: () => An,
	routerHistory: () => jn,
	selectedModuleId: () => Nn,
	selectedNetwork: () => On,
	showInstallLabel: () => wn,
	theme: () => kn,
	updateActiveSession: () => $n,
	updatedSelectedModule: () => Qn,
	updatedThemeEffect: () => Zn,
	wcSessionPaths: () => Vn
}), Qa = t((() => {
	Xa(), qa(), tr(), q();
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/random-token-generator.js
function $a() {
	let e = /* @__PURE__ */ new Uint32Array(4);
	if (typeof crypto < "u" && crypto.getRandomValues) crypto.getRandomValues(e);
	else for (let t = 0; t < e.length; t++) e[t] = Math.floor(Math.random() * 4294967295);
	return Array.from(e).map((e) => e.toString(36)).join("");
}
var eo = t((() => {})), to, no = t((() => {
	to = {
		public_key: {
			title: "View public key",
			description: "Requests account public key. It's a simple way of authentication for Stellar-based applications. The response ensures that a user owns the corresponding secret key.",
			implicitFlow: !1,
			params: {
				token: {
					description: "Verification token generated by the application (should be unique or random).",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST a signed token and public key.",
					type: "string",
					required: !1
				},
				require_existing: {
					description: "Allow existing Albedo accounts only.",
					type: "boolean",
					required: !1
				}
			},
			returns: {
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				signed_message: {
					description: "HEX-encoded authentication message derived from the public key and verification token.",
					type: "string"
				},
				signature: {
					description: "HEX-encoded ED25519 signature of the authentication message that can be further used to verify user's keypair ownership.",
					type: "string"
				}
			}
		},
		sign_message: {
			title: "Sign text message",
			description: "Requests arbitrary message signing. Can be used to implement identity/ownership verification.",
			implicitFlow: !0,
			params: {
				message: {
					description: "Text message to sign.",
					type: "string",
					required: !0
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST a signed message.",
					type: "string",
					required: !1
				}
			},
			returns: {
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				original_message: {
					description: "Text message to sign from request.",
					type: "string"
				},
				signed_message: {
					description: "HEX-encoded message derived from the public key and original message.",
					type: "string"
				},
				message_signature: {
					description: "HEX-encoded ED25519 signature of the signed message.",
					type: "string"
				}
			}
		},
		tx: {
			title: "Sign transaction",
			description: "Requests a signature for the transaction. Returns the signed transaction envelope that can be submitted to the network or used for multi-sig coordination.",
			implicitFlow: !0,
			params: {
				xdr: {
					description: "XDR-encoded transaction envelope to sign.",
					type: "string",
					required: !0
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				network: {
					description: "Stellar network identifier.",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST the signed transaction XDR instead of submitting it to Horizon.",
					type: "string",
					required: !1
				},
				description: {
					description: "Optional human-friendly short transaction description provided by developers.",
					type: "string",
					required: !1
				},
				submit: {
					description: "If set, the signed transaction will be submitted to the Horizon server instead of returning it to the application.",
					type: "boolean",
					required: !1
				}
			},
			returns: {
				xdr: {
					description: "XDR-encoded transaction envelope from request.",
					type: "string"
				},
				tx_hash: {
					description: "HEX-encoded transaction hash.",
					type: "string"
				},
				signed_envelope_xdr: {
					description: "XDR-encoded transaction envelope with new signatures.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				},
				result: {
					description: "Optional response from Horizon if the transaction has been submitted automatically.",
					type: "object"
				}
			}
		},
		pay: {
			title: "Make payment",
			description: "Requests a payment from a user. Works with any Stellar asset, supports transaction memo.",
			implicitFlow: !0,
			params: {
				amount: {
					description: "Requested payment amount.",
					type: "string",
					required: !0
				},
				destination: {
					description: "Payment destination address.",
					type: "string",
					required: !0
				},
				asset_code: {
					description: "Asset code (skip for XLM).",
					type: "string",
					required: !1
				},
				asset_issuer: {
					description: "Asset issuer (skip for XLM).",
					type: "string",
					required: !1
				},
				memo: {
					description: "Transaction memo (required for exchanges and some anchors).",
					type: "string",
					required: !1
				},
				memo_type: {
					description: "Transaction memo type.",
					type: "string",
					required: !1
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST the signed transaction XDR instead of submitting it to Horizon. ",
					type: "string",
					required: !1
				},
				submit: {
					description: "If set, the signed transaction will be submitted to the Horizon server instead of returning it to the application.",
					type: "boolean",
					required: !1
				}
			},
			returns: {
				amount: {
					description: "Payment amount from request.",
					type: "string"
				},
				destination: {
					description: "Payment destination address from request.",
					type: "string"
				},
				asset_code: {
					description: "Asset code from request.",
					type: "string"
				},
				asset_issuer: {
					description: "Asset issuer from request.",
					type: "string"
				},
				memo: {
					description: "Transaction memo from request.",
					type: "string"
				},
				memo_type: {
					description: "Transaction memo type from request.",
					type: "string"
				},
				tx_hash: {
					description: "HEX-encoded transaction hash.",
					type: "string"
				},
				signed_envelope_xdr: {
					description: "XDR-encoded transaction envelope with new signatures.",
					type: "string"
				},
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				},
				result: {
					description: "Optional response from Horizon if the transaction has been submitted automatically.",
					type: "object"
				}
			}
		},
		trust: {
			title: "Establish trustline",
			description: "Requests permission to create a trustline to a given Stellar asset. Gradually simplifies the process of creating trustlines for anchors, ICOs, and airdrops.",
			implicitFlow: !0,
			params: {
				asset_code: {
					description: "Trustline asset code.",
					type: "string",
					required: !0
				},
				asset_issuer: {
					description: "Trustline asset issuer address.",
					type: "string",
					required: !0
				},
				limit: {
					description: "Trust limit.",
					type: "string",
					required: !1
				},
				memo: {
					description: "Transaction memo (required for exchanges and some anchors).",
					type: "string",
					required: !1
				},
				memo_type: {
					description: "Transaction memo type.",
					type: "string",
					required: !1
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST the signed transaction XDR instead of submitting it to Horizon. ",
					type: "string",
					required: !1
				},
				submit: {
					description: "If set, the signed transaction will be submitted to the Horizon server instead of returning it to the application.",
					type: "boolean",
					required: !1
				}
			},
			returns: {
				asset_code: {
					description: "Trustline asset code from request.",
					type: "string"
				},
				asset_issuer: {
					description: "Trustline asset issuer address from request.",
					type: "string"
				},
				limit: {
					description: "Trust limit from request.",
					type: "string"
				},
				tx_hash: {
					description: "HEX-encoded transaction hash.",
					type: "string"
				},
				signed_envelope_xdr: {
					description: "XDR-encoded transaction envelope with new signatures.",
					type: "string"
				},
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				},
				result: {
					description: "Optional response from Horizon if the transaction has been submitted automatically.",
					type: "object"
				}
			}
		},
		exchange: {
			title: "Swap tokens",
			description: "Requests permission to buy tokens on Stellar DEX at market price.",
			implicitFlow: !1,
			params: {
				amount: {
					description: "The amount of asset to buy.",
					type: "string",
					required: !0
				},
				max_price: {
					description: "Maximum price the user willing to pay.",
					type: "string",
					required: !0
				},
				sell_asset_code: {
					description: "Asset code of the asset to sell.",
					type: "string",
					required: !1
				},
				sell_asset_issuer: {
					description: "Issuer account of the asset to sell.",
					type: "string",
					required: !1
				},
				buy_asset_code: {
					description: "Asset code of the asset to buy.",
					type: "string",
					required: !1
				},
				buy_asset_issuer: {
					description: "Issuer account of the asset to buy.",
					type: "string",
					required: !1
				},
				memo: {
					description: "Transaction memo (required for exchanges and some anchors).",
					type: "string",
					required: !1
				},
				memo_type: {
					description: "Transaction memo type.",
					type: "string",
					required: !1
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				},
				callback: {
					description: "Optional URL callback where Albedo will POST the signed transaction XDR instead of submitting it to Horizon.",
					type: "string",
					required: !1
				},
				submit: {
					description: "If set, the signed transaction will be submitted to the Horizon server instead of returning it to the application.",
					type: "boolean",
					required: !1
				}
			},
			returns: {
				amount: {
					description: "The amount of asset to buy from request.",
					type: "string"
				},
				max_price: {
					description: "Maximum price the user willing to pay from request.",
					type: "string"
				},
				sell_asset_code: {
					description: "Asset code of the asset to sell from request.",
					type: "string"
				},
				sell_asset_issuer: {
					description: "Issuer account of the asset to sell from request.",
					type: "string"
				},
				buy_asset_code: {
					description: "Asset code of the asset to buy from request.",
					type: "string"
				},
				buy_asset_issuer: {
					description: "Issuer account of the asset to buy from request.",
					type: "string"
				},
				tx_hash: {
					description: "HEX-encoded transaction hash.",
					type: "string"
				},
				signed_envelope_xdr: {
					description: "XDR-encoded transaction envelope with new signatures.",
					type: "string"
				},
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				},
				result: {
					description: "Optional response from Horizon if the transaction has been submitted automatically.",
					type: "object"
				}
			}
		},
		implicit_flow: {
			title: "Implicit permissions",
			description: "Requests temporary access token for one or more intents that can be used to execute actions without explicit confirmation from the user. In order to be executed implicitly, an implicit flow permissions for a given intent should be granted and \"pubkey\" parameter set.",
			implicitFlow: !1,
			params: {
				intents: {
					description: "Requested implicit flow intents.",
					type: "string|string[]",
					required: !0
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				}
			},
			returns: {
				granted: {
					description: "Whether a user granted permissions or not.",
					type: "boolean"
				},
				intents: {
					description: "Requested implicit flow intents.",
					type: "string[]"
				},
				grants: {
					description: "Implicit flow intents that have been granted.",
					type: "string[]"
				},
				session: {
					description: "Unique implicit session id.",
					type: "string"
				},
				valid_until: {
					description: "Session expiration timestamp.",
					type: "number"
				},
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				}
			}
		},
		manage_account: {
			title: "Open account settings",
			description: "Opens account settings window for a given account.",
			implicitFlow: !1,
			params: {
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !0
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				}
			},
			returns: { pubkey: {
				description: "Public key from intent request.",
				type: "string"
			} }
		},
		batch: {
			title: "Intents batch",
			description: "Requests execution of several tx intents bundled together. This intent is atomic – a user confirms or rejects all bundled requests at once, with the same account and the same Stellar network.",
			implicitFlow: !0,
			params: {
				intents: {
					description: "Requested tx intents that should be executed together.",
					type: "object[]",
					required: !0
				},
				pubkey: {
					description: "Specific public key requested by the application.",
					type: "string",
					required: !1
				},
				network: {
					description: "Stellar network identifier or private network passphrase.",
					type: "string",
					required: !1
				}
			},
			returns: {
				intents: {
					description: "Requested tx intents.",
					type: "object[]"
				},
				results: {
					description: "Array of results for each requested intent.",
					type: "object[]"
				},
				pubkey: {
					description: "User-selected public key.",
					type: "string"
				},
				network: {
					description: "Stellar network identifier.",
					type: "string"
				}
			}
		}
	};
})), ro, io = t((() => {
	ro = {
		unhandledError: {
			message: "Unhandled error occurred. If this error persists, please contact Albedo support.",
			code: -1
		},
		externalError: {
			message: "External error occurred.",
			code: -2
		},
		invalidIntentRequest: {
			message: "Intent request is invalid.",
			code: -3
		},
		actionRejectedByUser: {
			message: "Action request was rejected by the user.",
			code: -4
		},
		horizonError: {
			message: "Transaction failed when submitted to Stellar network.",
			code: -5
		},
		callbackError: {
			message: "Callback redirect failed.",
			code: -6
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/transport-handler.js
function ao(e, t = !1) {
	this.windowHandler = e, this.ephemeral = !!t, this.isLoaded = !1, this.pendingRequests = {}, this.preprocessRequestParams = null, this.onLoaded = new Promise((e, t) => this.onLoadedCallback = e).then(() => this), this.messageHandler = this.messageHandler.bind(this), window.addEventListener("message", this.messageHandler, !1);
}
function oo(e, t, n) {
	n.error ? t(n) : e(n);
}
var so = t((() => {
	eo(), io(), ao.prototype = {
		isLoaded: !1,
		protocolVersion: 3,
		markLoaded() {
			let { onLoadedCallback: e } = this;
			e && (this.onLoadedCallback = null, this.isLoaded = !0, e());
		},
		messageHandler({ data: e }) {
			if (e.albedo) return this.matchProtocolVersion(e.albedo.protocol), this.markLoaded();
			if (e.albedoIntentResult) {
				let { __reqid: t, ...n } = e.albedoIntentResult, r = this.pendingRequests[t];
				r && (delete this.pendingRequests[t], r(n), this.ephemeral && (window.removeEventListener("message", this.messageHandler, !1), this.windowHandler.close()));
			}
		},
		transportCloseHandler() {
			for (let e in this.pendingRequests) if (this.pendingRequests.hasOwnProperty(e)) {
				let t = this.pendingRequests[e];
				delete this.pendingRequests[e], t(ro.actionRejectedByUser);
			}
		},
		postMessage(e) {
			let t = $a();
			return new Promise((n, r) => {
				this.onLoaded.then(() => {
					this.pendingRequests[t] = oo.bind(this, n, r), e = Object.assign({
						__reqid: t,
						__albedo_intent_version: this.protocolVersion
					}, e), this.preprocessRequestParams && (e = this.preprocessRequestParams(e)), this.windowHandler.postMessage(e, "*");
				});
			});
		},
		matchProtocolVersion(e) {
			let t = e - this.protocolVersion;
			if (t === 0) return;
			let n = `@albedo-link/intent module protocol version (${this.protocolVersion}) is incompatible with current Albedo protocol version ${e}.`;
			if (t > 0) console.warn(n + " Please update @albedo-link/intent module to avoid possible connection problems.");
			else if (t < 0) throw this.windowHandler.close(), Error(n);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/transport-builder.js
function co(e) {
	let t = `${e}/confirm`, n = window.screenLeft === void 0 ? window.screenX : window.screenLeft, r = window.screenTop === void 0 ? window.screenY : window.screenTop, i = window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : screen.width, a = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height, o = i / 2 - 480 / 2 + n, s = a / 2 - 600 / 2 + r;
	return new ao(window.open(t, "auth.albedo.link", `height=600,width=480,top=${s},left=${o},menubar=0,toolbar=0,location=0,status=0,personalbar=0,scrollbars=0,dependent=1`), !0).onLoaded;
}
function lo(e) {
	if (!uo) {
		let t = document.createElement("iframe");
		t.style.border = "none", Object.assign(t, {
			width: "0",
			height: "0",
			frameBorder: "0",
			referrerPolicy: "origin",
			src: `${e}`
		}), document.body.appendChild(t), uo = new ao(t.contentWindow);
	}
	return uo.onLoaded;
}
var uo, fo = t((() => {
	so(), uo = null;
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/implicit-session.js
function po({ session: e, pubkey: t, grants: n, valid_until: r }) {
	this.key = e, this.pubkey = t, this.grants = n.slice(), this.validUntil = r, Object.freeze(this), Object.freeze(this.grants);
}
var mo = t((() => {
	po.prototype = {
		key: "",
		pubkey: "",
		grants: [],
		validUntil: 0,
		get isExpired() {
			return this.validUntil - 2e3 < (/* @__PURE__ */ new Date()).getTime();
		},
		toJSON() {
			return {
				session: this.key,
				pubkey: this.pubkey,
				grants: this.grants.slice(),
				valid_until: this.validUntil
			};
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/implicit-session-storage.js
function ho() {
	return window.sessionStorage;
}
function go(e) {
	let t = new po(e);
	ho().setItem(xo + t.pubkey, JSON.stringify(t));
}
function _o(e) {
	let t;
	{
		let n = ho().getItem(xo + e);
		n && (t = new po(JSON.parse(n)));
	}
	return t ? t.isExpired ? (bo(e), null) : t : null;
}
function vo(e, t) {
	let n = _o(t);
	return !n || !n.grants.includes(e) ? null : n;
}
function yo() {
	let e = ho();
	return Object.keys(e).filter((e) => e.indexOf(xo) === 0).map((e) => _o(e.substr(15))).filter((e) => !!e);
}
function bo(e) {
	ho().removeItem(xo + e);
}
var xo, So = t((() => {
	mo(), xo = "albedo_session_";
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/intent-dispatcher.js
function Co(e) {
	return Object.assign(/* @__PURE__ */ Error(), ro.invalidIntentRequest, { ext: e });
}
function wo(e, t) {
	try {
		let { intent: n } = e;
		if (!n) throw Co("Parameter \"intent\" is required.");
		let r = to[n];
		if (!r) throw Co(`Unknown intent: "${n}".`);
		let i = Do(r, e);
		return To(i, t).then((e) => Eo(i, e));
	} catch (e) {
		let { code: t = -1, message: n, ext: r } = e, i = {
			message: n,
			code: t
		};
		return r && (i.ext = r), Promise.reject(i);
	}
}
function To(e, t) {
	if (e.pubkey) {
		let n = vo(e.intent, e.pubkey);
		if (n) return e.session = n.key, lo(t);
	}
	return setTimeout(() => {
		e.intent === "implicit_flow" && lo(t);
	}, 200), co(t);
}
function Eo(e, t) {
	return t.postMessage(e).then((e) => (e.intent === "implicit_flow" && e.granted && go(e), e));
}
function Do(e, t) {
	if (typeof t != "object") throw Co("Intent parameters expected.");
	let { intent: n, pubkey: r } = t, i = { intent: n };
	if (r && !/^G[0-9A-Z]{55}$/.test(r)) throw Co("Invalid \"pubkey\" parameter. Stellar account public key expected.");
	for (let r in e.params) {
		let a = e.params[r], o = t[r];
		if (o) i[r] = o;
		else if (a.required) throw Co(`Parameter "${r}" is required for intent "${n}".`);
	}
	return i;
}
var Oo = t((() => {
	no(), io(), fo(), So();
}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/web+stellar-handler.js
function ko(e = null) {
	e === null && (e = window.location.search), e[0] === "?" && (e = e.substr(1));
	let t = {};
	for (let n of e.split("&")) {
		let [e, r] = n.split("=").map((e) => decodeURIComponent(e));
		t[e] = r;
	}
	return t;
}
function Ao(e) {
	typeof document > "u" || !document.addEventListener || document.addEventListener("click", function(t) {
		if (t.target.tagName !== "A" || (t.target.href || "").indexOf("web+stellar:") !== 0) return;
		t.preventDefault(), t.stopImmediatePropagation();
		let { pathname: n, search: r } = new URL(t.target.href);
		if (!["tx", "pay"].includes(n)) {
			alert(`Invalid operation requested: ${n}. It's likely an external application error. Please contact support team of ${window.location.origin}.`);
			return;
		}
		let i = ko(r);
		e.request(n, i);
	}, !1);
}
var jo = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/@albedo-link+intent@0.12.0/node_modules/@albedo-link/intent/src/index.js
function Mo() {}
function No(e) {
	switch (typeof e) {
		case "string": return e;
		case "undefined": return "";
	}
	return JSON.stringify(e);
}
var Po, Fo = t((() => {
	if (eo(), no(), io(), Oo(), So(), jo(), typeof window == "object" && typeof window.fetch != "function") throw Error("Browser FetchAPI is not available. For legacy browsers support use polyfills such as whatwg-fetch.");
	Mo.prototype = {
		frontendUrl: "https://albedo.link",
		intentInterface: to,
		intentErrors: ro,
		request(e, t) {
			return wo(Object.assign(t || {}, { intent: e }), this.frontendUrl);
		},
		implicitFlow(e) {
			return this.request("implicit_flow", e);
		},
		publicKey(e) {
			return e = Object.assign({}, e), e.token ||= $a(), this.request("public_key", e);
		},
		tx(e) {
			return this.request("tx", e);
		},
		batch(e) {
			return this.request("batch", e);
		},
		pay(e) {
			return this.request("pay", e);
		},
		trust(e) {
			return this.request("trust", e);
		},
		exchange(e) {
			return this.request("exchange", e);
		},
		signMessage(e) {
			return e = Object.assign({}, e, { message: No(e.message) }), this.request("sign_message", e);
		},
		manageAccount(e) {
			return this.request("manage_account", e);
		},
		generateRandomToken() {
			return $a();
		},
		isImplicitSessionAllowed(e, t) {
			return !!vo(e, t);
		},
		listImplicitSessions() {
			return yo();
		},
		forgetImplicitSession(e) {
			bo(e);
		}
	}, Po = new Mo(), Po.default = Po, Ao(Po);
})), Io, Lo, Ro, zo, Bo = t((() => {
	Fo(), q(), Ma(), Io = Po.default, Lo = "albedo", Ro = class {
		moduleType = K.HOT_WALLET;
		productId = Lo;
		productName = "Albedo";
		productUrl = "https://albedo.link/";
		productIcon = "https://stellar.creit.tech/wallet-icons/albedo.png";
		async isAvailable() {
			return !0;
		}
		async getAddress() {
			try {
				return { address: (await Io.publicKey({})).pubkey };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				let { signed_envelope_xdr: n } = await Io.tx({
					xdr: e,
					pubkey: t?.address,
					network: t?.networkPassphrase ? t.networkPassphrase === G.PUBLIC ? zo.PUBLIC : zo.TESTNET : void 0
				});
				return {
					signedTxXdr: n,
					signerAddress: t?.address
				};
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry() {
			throw {
				code: -3,
				message: "Albedo does not support the \"signAuthEntry\" function"
			};
		}
		async signMessage() {
			throw {
				code: -3,
				message: "Albedo does not support the \"signMessage\" function"
			};
		}
		async getNetwork() {
			throw {
				code: -3,
				message: "Albedo does not support the \"getNetwork\" function"
			};
		}
	}, zo = /*#__PURE__*/ function(e) {
		return e.PUBLIC = "public", e.TESTNET = "testnet", e;
	}({});
})), Vo = /* @__PURE__ */ n(((e, t) => {
	(function(n, r) {
		typeof e == "object" && typeof t == "object" ? t.exports = r() : typeof define == "function" && define.amd ? define([], r) : typeof e == "object" ? e.freighterApi = r() : n.freighterApi = r();
	})(e, () => (() => {
		var e, t, n = {
			d: (e, t) => {
				for (var r in t) n.o(t, r) && !n.o(e, r) && Object.defineProperty(e, r, {
					enumerable: !0,
					get: t[r]
				});
			},
			o: (e, t) => Object.prototype.hasOwnProperty.call(e, t),
			r: (e) => {
				typeof Symbol < "u" && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 });
			}
		}, r = {};
		n.r(r), n.d(r, {
			WatchWalletChanges: () => S,
			addToken: () => f,
			default: () => w,
			getAddress: () => d,
			getNetwork: () => _,
			getNetworkDetails: () => v,
			isAllowed: () => y,
			isBrowser: () => C,
			isConnected: () => g,
			requestAccess: () => x,
			setAllowed: () => b,
			signAuthEntry: () => h,
			signMessage: () => m,
			signTransaction: () => p
		}), function(e) {
			e.CREATE_ACCOUNT = "CREATE_ACCOUNT", e.FUND_ACCOUNT = "FUND_ACCOUNT", e.ADD_ACCOUNT = "ADD_ACCOUNT", e.IMPORT_ACCOUNT = "IMPORT_ACCOUNT", e.IMPORT_HARDWARE_WALLET = "IMPORT_HARDWARE_WALLET", e.LOAD_ACCOUNT = "LOAD_ACCOUNT", e.MAKE_ACCOUNT_ACTIVE = "MAKE_ACCOUNT_ACTIVE", e.UPDATE_ACCOUNT_NAME = "UPDATE_ACCOUNT_NAME", e.GET_MNEMONIC_PHRASE = "GET_MNEMONIC_PHRASE", e.CONFIRM_MNEMONIC_PHRASE = "CONFIRM_MNEMONIC_PHRASE", e.CONFIRM_MIGRATED_MNEMONIC_PHRASE = "CONFIRM_MIGRATED_MNEMONIC_PHRASE", e.RECOVER_ACCOUNT = "RECOVER_ACCOUNT", e.CONFIRM_PASSWORD = "CONFIRM_PASSWORD", e.REJECT_ACCESS = "REJECT_ACCESS", e.GRANT_ACCESS = "GRANT_ACCESS", e.ADD_TOKEN = "ADD_TOKEN", e.SIGN_TRANSACTION = "SIGN_TRANSACTION", e.SIGN_BLOB = "SIGN_BLOB", e.SIGN_AUTH_ENTRY = "SIGN_AUTH_ENTRY", e.HANDLE_SIGNED_HW_PAYLOAD = "HANDLE_SIGNED_HW_PAYLOAD", e.REJECT_TRANSACTION = "REJECT_TRANSACTION", e.SIGN_FREIGHTER_TRANSACTION = "SIGN_FREIGHTER_TRANSACTION", e.SIGN_FREIGHTER_SOROBAN_TRANSACTION = "SIGN_FREIGHTER_SOROBAN_TRANSACTION", e.ADD_RECENT_ADDRESS = "ADD_RECENT_ADDRESS", e.LOAD_RECENT_ADDRESSES = "LOAD_RECENT_ADDRESSES", e.LOAD_LAST_USED_ACCOUNT = "LOAD_LAST_USED_ACCOUNT", e.SIGN_OUT = "SIGN_OUT", e.SHOW_BACKUP_PHRASE = "SHOW_BACKUP_PHRASE", e.SAVE_ALLOWLIST = "SAVE_ALLOWLIST", e.SAVE_SETTINGS = "SAVE_SETTINGS", e.SAVE_EXPERIMENTAL_FEATURES = "SAVE_EXPERIMENTAL_FEATURES", e.LOAD_SETTINGS = "LOAD_SETTINGS", e.GET_CACHED_ASSET_ICON = "GET_CACHED_ASSET_ICON", e.CACHE_ASSET_ICON = "CACHE_ASSET_ICON", e.GET_CACHED_ASSET_DOMAIN = "GET_CACHED_ASSET_DOMAIN", e.CACHE_ASSET_DOMAIN = "CACHE_ASSET_DOMAIN", e.GET_MEMO_REQUIRED_ACCOUNTS = "GET_MEMO_REQUIRED_ACCOUNTS", e.ADD_CUSTOM_NETWORK = "ADD_CUSTOM_NETWORK", e.CHANGE_NETWORK = "CHANGE_NETWORK", e.REMOVE_CUSTOM_NETWORK = "REMOVE_CUSTOM_NETWORK", e.EDIT_CUSTOM_NETWORK = "EDIT_CUSTOM_NETWORK", e.RESET_EXP_DATA = "RESET_EXP_DATA", e.ADD_TOKEN_ID = "ADD_TOKEN_ID", e.GET_TOKEN_IDS = "GET_TOKEN_IDS", e.REMOVE_TOKEN_ID = "REMOVE_TOKEN_ID", e.GET_MIGRATABLE_ACCOUNTS = "GET_MIGRATABLE_ACCOUNTS", e.GET_MIGRATED_MNEMONIC_PHRASE = "GET_MIGRATED_MNEMONIC_PHRASE", e.MIGRATE_ACCOUNTS = "MIGRATE_ACCOUNTS", e.ADD_ASSETS_LIST = "ADD_ASSETS_LIST", e.MODIFY_ASSETS_LIST = "MODIFY_ASSETS_LIST", e.CHANGE_ASSET_VISIBILITY = "CHANGE_ASSET_VISIBILITY", e.GET_HIDDEN_ASSETS = "GET_HIDDEN_ASSETS", e.GET_IS_ACCOUNT_MISMATCH = "GET_IS_ACCOUNT_MISMATCH";
		}(e ||= {}), function(e) {
			e.REQUEST_ACCESS = "REQUEST_ACCESS", e.REQUEST_PUBLIC_KEY = "REQUEST_PUBLIC_KEY", e.SUBMIT_TOKEN = "SUBMIT_TOKEN", e.SUBMIT_TRANSACTION = "SUBMIT_TRANSACTION", e.SUBMIT_BLOB = "SUBMIT_BLOB", e.SUBMIT_AUTH_ENTRY = "SUBMIT_AUTH_ENTRY", e.REQUEST_NETWORK = "REQUEST_NETWORK", e.REQUEST_NETWORK_DETAILS = "REQUEST_NETWORK_DETAILS", e.REQUEST_CONNECTION_STATUS = "REQUEST_CONNECTION_STATUS", e.REQUEST_ALLOWED_STATUS = "REQUEST_ALLOWED_STATUS", e.SET_ALLOWED_STATUS = "SET_ALLOWED_STATUS", e.REQUEST_USER_INFO = "REQUEST_USER_INFO";
		}(t ||= {});
		let i = (e) => {
			let n = Date.now() + Math.random();
			return window.postMessage({
				source: "FREIGHTER_EXTERNAL_MSG_REQUEST",
				messageId: n,
				...e
			}, window.location.origin), new Promise((r) => {
				let i = 0;
				e.type !== t.REQUEST_CONNECTION_STATUS && e.type !== t.REQUEST_PUBLIC_KEY || (i = setTimeout(() => {
					r({
						isConnected: !1,
						publicKey: ""
					}), window.removeEventListener("message", a);
				}, 2e3));
				let a = (e) => {
					e.source === window && e?.data?.source === "FREIGHTER_EXTERNAL_MSG_RESPONSE" && e?.data?.messagedId === n && (r(e.data), window.removeEventListener("message", a), clearTimeout(i));
				};
				window.addEventListener("message", a, !1);
			});
		}, a = {
			code: -1,
			message: "Node environment is not supported"
		}, o = {
			code: -1,
			message: "The wallet encountered an internal error. Please try again or contact the wallet if the problem persists."
		}, s = async () => {
			let e;
			try {
				e = await i({ type: t.REQUEST_ACCESS });
			} catch (e) {
				console.error(e);
			}
			let { publicKey: n } = e || { publicKey: "" };
			return {
				publicKey: n,
				error: e?.apiError
			};
		}, c = async () => {
			let e;
			try {
				e = await i({ type: t.REQUEST_PUBLIC_KEY });
			} catch (e) {
				console.error(e);
			}
			return {
				publicKey: e?.publicKey || "",
				error: e?.apiError
			};
		}, l = async () => {
			let e;
			try {
				e = await i({ type: t.REQUEST_NETWORK_DETAILS });
			} catch (e) {
				console.error(e);
			}
			let { networkDetails: n, apiError: r } = e || { networkDetails: {
				network: "",
				networkName: "",
				networkUrl: "",
				networkPassphrase: "",
				sorobanRpcUrl: void 0,
				apiError: ""
			} }, { network: a, networkUrl: o, networkPassphrase: s, sorobanRpcUrl: c } = n;
			return {
				network: a,
				networkUrl: o,
				networkPassphrase: s,
				sorobanRpcUrl: c,
				error: r
			};
		}, u = async () => {
			let e;
			try {
				e = await i({ type: t.REQUEST_ALLOWED_STATUS });
			} catch (e) {
				console.error(e);
			}
			let { isAllowed: n } = e || { isAllowed: !1 };
			return {
				isAllowed: n,
				error: e?.apiError
			};
		}, d = async () => {
			let e = "";
			if (C) {
				let t = await c();
				return e = t.publicKey, t.error ? {
					address: e,
					error: t.error
				} : { address: e };
			}
			return {
				address: e,
				error: a
			};
		}, f = async (e) => {
			if (C) {
				let n = await (async (e) => {
					let n;
					try {
						n = await i({
							contractId: e.contractId,
							networkPassphrase: e.networkPassphrase,
							type: t.SUBMIT_TOKEN
						});
					} catch {
						return { error: o };
					}
					return {
						contractId: n.contractId,
						error: n?.apiError
					};
				})(e);
				return n.error ? {
					contractId: "",
					error: n.error
				} : { contractId: n.contractId || "" };
			}
			return {
				contractId: "",
				error: a
			};
		}, p = async (e, n) => {
			if (C) {
				let r = await (async (e, n) => {
					let r, a, s, c;
					typeof n == "object" ? (a = n.accountToSign, s = n.networkPassphrase) : (r = n, a = void 0);
					try {
						c = await i({
							transactionXdr: e,
							network: r,
							networkPassphrase: s,
							accountToSign: a,
							type: t.SUBMIT_TRANSACTION
						});
					} catch {
						return {
							signedTransaction: "",
							signerAddress: "",
							error: o
						};
					}
					let { signedTransaction: l, signerAddress: u } = c;
					return {
						signedTransaction: l,
						signerAddress: u,
						error: c?.apiError
					};
				})(e, n);
				return r.error ? {
					signedTxXdr: "",
					signerAddress: "",
					error: r.error
				} : {
					signedTxXdr: r.signedTransaction,
					signerAddress: r.signerAddress
				};
			}
			return {
				signedTxXdr: "",
				signerAddress: "",
				error: a
			};
		}, m = async (e, n) => {
			if (C) {
				let { isAllowed: r } = await u();
				if (!r) {
					let e = await s();
					if (e.error) return {
						signedMessage: null,
						signerAddress: "",
						error: e.error
					};
				}
				let a = await (async (e, n, r) => {
					let a, s = (r || {}).address;
					try {
						a = await i({
							blob: e,
							accountToSign: s,
							apiVersion: "6.0.0",
							networkPassphrase: r?.networkPassphrase,
							type: t.SUBMIT_BLOB
						});
					} catch {
						return {
							signedMessage: null,
							signerAddress: "",
							error: o
						};
					}
					let { signedBlob: c, signerAddress: l } = a;
					return {
						signedMessage: c || null,
						signerAddress: l,
						error: a?.apiError
					};
				})(e, 0, n);
				return a.error ? {
					signedMessage: null,
					signerAddress: "",
					error: a.error
				} : {
					signedMessage: a.signedMessage,
					signerAddress: a.signerAddress
				};
			}
			return {
				signedMessage: null,
				signerAddress: "",
				error: a
			};
		}, h = async (e, n) => {
			if (C) {
				let { isAllowed: r } = await u();
				if (!r) {
					let e = await s();
					if (e.error) return {
						signedAuthEntry: null,
						signerAddress: "",
						error: e.error
					};
				}
				let a = await (async (e, n, r) => {
					let a = (r || {}).address, s;
					try {
						s = await i({
							entryXdr: e,
							accountToSign: a,
							apiVersion: "6.0.0",
							networkPassphrase: r?.networkPassphrase,
							type: t.SUBMIT_AUTH_ENTRY
						});
					} catch (e) {
						return console.error(e), {
							signedAuthEntry: null,
							signerAddress: "",
							error: o
						};
					}
					let { signedAuthEntry: c, signerAddress: l } = s;
					return {
						signedAuthEntry: c || null,
						signerAddress: l,
						error: s?.apiError
					};
				})(e, 0, n);
				return a.error ? {
					signedAuthEntry: null,
					signerAddress: "",
					error: a.error
				} : {
					signedAuthEntry: a.signedAuthEntry,
					signerAddress: a.signerAddress
				};
			}
			return {
				signedAuthEntry: null,
				signerAddress: "",
				error: a
			};
		}, g = async () => C ? window.freighter ? Promise.resolve({ isConnected: window.freighter }) : (async () => {
			let e = { isConnected: !1 };
			try {
				e = await i({ type: t.REQUEST_CONNECTION_STATUS });
			} catch (e) {
				console.error(e);
			}
			return { isConnected: e.isConnected };
		})() : {
			isConnected: !1,
			error: a
		}, _ = async () => {
			if (C) {
				let e = await (async () => {
					let e;
					try {
						e = await i({ type: t.REQUEST_NETWORK_DETAILS });
					} catch (e) {
						console.error(e);
					}
					let { networkDetails: n } = e || { networkDetails: {
						network: "",
						networkPassphrase: ""
					} };
					return {
						network: n?.network,
						networkPassphrase: n?.networkPassphrase,
						error: e?.apiError
					};
				})();
				return e.error ? {
					network: "",
					networkPassphrase: "",
					error: e.error
				} : {
					network: e.network,
					networkPassphrase: e.networkPassphrase
				};
			}
			return {
				network: "",
				networkPassphrase: "",
				error: a
			};
		}, v = async () => {
			if (C) {
				let e = await l();
				return e.error ? {
					network: "",
					networkUrl: "",
					networkPassphrase: "",
					error: e.error
				} : {
					network: e.network,
					networkUrl: e.networkUrl,
					networkPassphrase: e.networkPassphrase,
					sorobanRpcUrl: e.sorobanRpcUrl
				};
			}
			return {
				network: "",
				networkUrl: "",
				networkPassphrase: "",
				error: a
			};
		}, y = async () => {
			let e = !1;
			if (C) {
				let t = await u();
				return e = t.isAllowed, t.error ? {
					isAllowed: e,
					error: t.error
				} : { isAllowed: e };
			}
			return {
				isAllowed: e,
				error: a
			};
		}, b = async () => {
			let e = !1;
			if (C) {
				let n = await (async () => {
					let e;
					try {
						e = await i({ type: t.SET_ALLOWED_STATUS });
					} catch (e) {
						console.error(e);
					}
					let { isAllowed: n } = e || { isAllowed: !1 };
					return {
						isAllowed: n,
						error: e?.apiError
					};
				})();
				return e = n.isAllowed, n.error ? {
					isAllowed: e,
					error: n.error
				} : { isAllowed: e };
			}
			return {
				isAllowed: e,
				error: a
			};
		}, x = async () => {
			let e = "";
			if (C) {
				let t = await s();
				return e = t.publicKey, t.error ? {
					address: e,
					error: t.error
				} : { address: e };
			}
			return {
				address: e,
				error: a
			};
		};
		class S {
			constructor(e = 3e3) {
				this.fetchInfo = async (e) => {
					if (!this.isRunning) return;
					let t = await c(), n = await l();
					(t.error || n.error) && e({
						address: "",
						network: "",
						networkPassphrase: "",
						error: t.error || n.error
					}), this.currentAddress === t.publicKey && this.currentNetwork === n.network && this.currentNetworkPassphrase === n.networkPassphrase || (this.currentAddress = t.publicKey, this.currentNetwork = n.network, this.currentNetworkPassphrase = n.networkPassphrase, e({
						address: t.publicKey,
						network: n.network,
						networkPassphrase: n.networkPassphrase
					})), setTimeout(() => this.fetchInfo(e), this.timeout);
				}, this.timeout = e, this.currentAddress = "", this.currentNetwork = "", this.currentNetworkPassphrase = "", this.isRunning = !1;
			}
			watch(e) {
				return C ? (this.isRunning = !0, this.fetchInfo(e), {}) : { error: a };
			}
			stop() {
				this.isRunning = !1;
			}
		}
		let C = typeof window < "u", w = {
			getAddress: d,
			addToken: f,
			signTransaction: p,
			signMessage: m,
			signAuthEntry: h,
			isConnected: g,
			getNetwork: _,
			getNetworkDetails: v,
			isAllowed: y,
			setAllowed: b,
			requestAccess: x,
			WatchWalletChanges: S
		};
		return r;
	})());
})), Ho = t((() => {
	new TextEncoder();
})), Uo = t((() => {
	Ho();
})), Wo, Go, Ko = t((() => {
	Wo = {
		base32: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"),
		base32hex: new TextEncoder().encode("0123456789ABCDEFGHIJKLMNOPQRSTUV"),
		base32crockford: new TextEncoder().encode("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
	}, Go = {
		base32: (/* @__PURE__ */ new Uint8Array(128)).fill(32),
		base32hex: (/* @__PURE__ */ new Uint8Array(128)).fill(32),
		base32crockford: (/* @__PURE__ */ new Uint8Array(128)).fill(32)
	}, Wo.base32.forEach((e, t) => Go.base32[e] = t), Wo.base32hex.forEach((e, t) => Go.base32hex[e] = t), Wo.base32crockford.forEach((e, t) => Go.base32crockford[e] = t);
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+std__encoding@1.0.10/node_modules/@jsr/std__encoding/_common_detach.js
function qo(e, t) {
	let n = e.length;
	if (e.byteOffset) {
		let t = new Uint8Array(e.buffer);
		t.set(e), e = t.subarray(0, n);
	}
	return e = new Uint8Array(e.buffer.transfer(t)), e.set(e.subarray(0, n), t - n), [e, t - n];
}
var Jo = t((() => {})), Yo, Xo, Zo = t((() => {
	Ko(), Yo = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), Xo = (/* @__PURE__ */ new Uint8Array(128)).fill(32), Yo.forEach((e, t) => Xo[e] = t);
})), Qo = t((() => {
	Ho(), "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".split("");
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+std__encoding@1.0.10/node_modules/@jsr/std__encoding/_common64.js
function $o(e) {
	return ((e + 2) / 3 | 0) * 4;
}
function es(e, t, n, r, i) {
	for (t += 2; t < e.length; t += 3) {
		let i = e[t - 2] << 16 | e[t - 1] << 8 | e[t];
		e[n++] = r[i >> 18], e[n++] = r[i >> 12 & 63], e[n++] = r[i >> 6 & 63], e[n++] = r[i & 63];
	}
	switch (t) {
		case e.length + 1: {
			let a = e[t - 2] << 16;
			e[n++] = r[a >> 18], e[n++] = r[a >> 12 & 63], e[n++] = i, e[n++] = i;
			break;
		}
		case e.length: {
			let a = e[t - 2] << 16 | e[t - 1] << 8;
			e[n++] = r[a >> 18], e[n++] = r[a >> 12 & 63], e[n++] = r[a >> 6 & 63], e[n++] = i;
			break;
		}
	}
	return n;
}
var ts, ns, rs = t((() => {
	ts = {
		base64: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"),
		base64url: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
	}, ns = {
		base64: (/* @__PURE__ */ new Uint8Array(128)).fill(64),
		base64url: (/* @__PURE__ */ new Uint8Array(128)).fill(64)
	}, ts.base64.forEach((e, t) => ns.base64[e] = t), ts.base64url.forEach((e, t) => ns.base64url[e] = t);
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+std__encoding@1.0.10/node_modules/@jsr/std__encoding/base64.js
function is(e) {
	e = typeof e == "string" ? new TextEncoder().encode(e) : e instanceof ArrayBuffer ? new Uint8Array(e).slice() : e.slice();
	let [t, n] = qo(e, $o(e.length));
	return es(t, n, 0, os, as), new TextDecoder().decode(t);
}
var as, os, ss, cs = t((() => {
	rs(), Jo(), as = 61, os = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), ss = (/* @__PURE__ */ new Uint8Array(128)).fill(64), os.forEach((e, t) => ss[e] = t);
})), ls, us, ds = t((() => {
	rs(), ls = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), us = (/* @__PURE__ */ new Uint8Array(128)).fill(64), ls.forEach((e, t) => us[e] = t);
})), fs, ps, ms = t((() => {
	fs = new TextEncoder().encode("0123456789abcdef"), ps = (/* @__PURE__ */ new Uint8Array(128)).fill(16), fs.forEach((e, t) => ps[e] = t), new TextEncoder().encode("ABCDEF").forEach((e, t) => ps[e] = t + 10);
})), hs, gs, _s = t((() => {
	ms(), hs = new TextEncoder().encode("0123456789abcdef"), gs = (/* @__PURE__ */ new Uint8Array(128)).fill(16), hs.forEach((e, t) => gs[e] = t), new TextEncoder().encode("ABCDEF").forEach((e, t) => gs[e] = t + 10);
})), vs, ys = t((() => {
	vs = /* @__PURE__ */ new ArrayBuffer(8), new Uint32Array(vs), new BigUint64Array(vs);
})), bs = t((() => {
	Uo(), Zo(), Qo(), cs(), ds(), _s(), ys();
})), xs, Ss, Cs, ws = t((() => {
	xs = Vo(), bs(), q(), Ma(), Ss = "freighter", Cs = class {
		moduleType = K.HOT_WALLET;
		productId = Ss;
		productName = "Freighter";
		productUrl = "https://freighter.app";
		productIcon = "https://stellar.creit.tech/wallet-icons/freighter.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Freighter is not connected");
		}
		async isAvailable() {
			if (window.stellar?.provider === "freighter" && window.stellar?.platform === "mobile") return !1;
			try {
				let e = await (0, xs.isConnected)();
				return !e.error && e.isConnected;
			} catch (e) {
				return console.error(e), !1;
			}
		}
		async getAddress(e) {
			try {
				if (await this.runChecks(), e?.skipRequestAccess !== !0) {
					let e = await (0, xs.requestAccess)();
					if (e.error) return Promise.reject($(e.error));
				}
				let { address: t, error: n } = await (0, xs.getAddress)();
				return n ? Promise.reject(n) : t ? { address: t } : Promise.reject({
					code: -3,
					message: "Getting the address from Freighter is not allowed, please request access first."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				await this.runChecks();
				let { signedTxXdr: n, signerAddress: r, error: i } = await (0, xs.signTransaction)(e, {
					address: t?.address,
					networkPassphrase: t?.networkPassphrase
				});
				return i ? Promise.reject(i) : {
					signedTxXdr: n,
					signerAddress: r
				};
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry(e, t) {
			try {
				await this.runChecks();
				let { signedAuthEntry: n, signerAddress: r, error: i } = await (0, xs.signAuthEntry)(e, {
					address: t?.address,
					networkPassphrase: t?.networkPassphrase
				});
				return i ? Promise.reject(i) : n ? {
					signedAuthEntry: typeof n == "string" ? n : is(new Uint8Array(n)),
					signerAddress: r
				} : Promise.reject({
					code: -3,
					message: "signedAuthEntry returned from Freighter is undefined."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			try {
				await this.runChecks();
				let { signedMessage: n, signerAddress: r, error: i } = await (0, xs.signMessage)(e, {
					address: t?.address,
					networkPassphrase: t?.networkPassphrase
				});
				return i ? Promise.reject(i) : n ? {
					signedMessage: typeof n == "string" ? n : is(new Uint8Array(n)),
					signerAddress: r
				} : Promise.reject({
					code: -3,
					message: "signedMessage returned from Freighter is undefined."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async getNetwork() {
			try {
				await this.runChecks();
				let { network: e, networkPassphrase: t, error: n } = await (0, xs.getNetwork)();
				return n ? Promise.reject(n) : {
					network: e,
					networkPassphrase: t
				};
			} catch (e) {
				throw $(e);
			}
		}
	};
})), Ts = /* @__PURE__ */ n(((e, t) => {
	(function(n, r) {
		typeof e == "object" && typeof t == "object" ? t.exports = r() : typeof define == "function" && define.amd ? define([], r) : typeof e == "object" ? e.lobstrExtensionApi = r() : n.lobstrExtensionApi = r();
	})(e, () => (() => {
		var e = {
			d: (t, n) => {
				for (var r in n) e.o(n, r) && !e.o(t, r) && Object.defineProperty(t, r, {
					enumerable: !0,
					get: n[r]
				});
			},
			o: (e, t) => Object.prototype.hasOwnProperty.call(e, t),
			r: (e) => {
				typeof Symbol < "u" && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 });
			}
		}, t = {};
		e.r(t), e.d(t, {
			default: () => f,
			getPublicKey: () => s,
			isBrowser: () => d,
			isConnected: () => l,
			signMessage: () => u,
			signTransaction: () => c
		});
		let n = function(e) {
			return e[e.V1 = 0] = "V1", e[e.V2 = 1] = "V2", e;
		}({}), r = function(e) {
			return e.REQUEST_ACCESS = "REQUEST_ACCESS", e.SIGN = "SIGN", e.SUBMIT_TRANSACTION = "SUBMIT_TRANSACTION", e.SIGN_TRANSACTION = "SIGN_TRANSACTION", e.REQUEST_CONNECTION_STATUS = "REQUEST_CONNECTION_STATUS", e;
		}({}), i = "LOBSTR_CONNECTION_KEY", a = (e) => {
			let t = Date.now() + Math.random();
			return window.postMessage({
				source: "LOBSTR_EXTERNAL_MSG_REQUEST",
				messageId: t,
				...e
			}, window.location.origin), new Promise((n) => {
				let i = 0;
				e.type === r.REQUEST_CONNECTION_STATUS && (i = setTimeout(() => {
					n({ isConnected: !1 }), window.removeEventListener("message", a);
				}, 2e3));
				let a = (e) => {
					var r, o;
					e.source === window && (e == null || (r = e.data) == null ? void 0 : r.source) === "LOBSTR_EXTERNAL_MSG_RESPONSE" && (e == null || (o = e.data) == null ? void 0 : o.messagedId) === t && (n(e.data), window.removeEventListener("message", a), clearTimeout(i));
				};
				window.addEventListener("message", a, !1);
			});
		}, o = async (e, t, i) => {
			let o = {
				signedData: "",
				error: "",
				signerAddress: ""
			};
			try {
				o = await a({
					dataToSign: e,
					connectionKey: t,
					signType: i,
					type: r.SIGN,
					version: n.V2
				});
			} catch (e) {
				throw console.error(e), e;
			}
			if (o.error) throw o.error;
			return o;
		}, s = async () => {
			if (!d) return "";
			let { publicKey: e, connectionKey: t } = await (async () => {
				let e = {
					publicKey: "",
					error: "",
					connectionKey: ""
				};
				try {
					e = await a({
						type: r.REQUEST_ACCESS,
						version: n.V2
					});
				} catch (e) {
					console.error(e);
				}
				let { publicKey: t, connectionKey: i, error: o } = e;
				if (o) throw o;
				return {
					publicKey: t,
					connectionKey: i
				};
			})();
			return ((e) => {
				var t, n;
				(t = window) == null || (n = t.sessionStorage) == null || n.setItem(i, e);
			})(t), e;
		}, c = async (e) => {
			if (!d) return Promise.resolve("");
			let t = ((n = window) == null || (r = n.sessionStorage) == null ? void 0 : r.getItem(i)) || "";
			var n, r;
			return (await o(e, t, "transaction")).signedData;
		}, l = async () => !!d && (window.lobstrSignerExtension ? window.lobstrSignerExtension : await (async () => {
			let e = { isConnected: !1 };
			try {
				e = await a({
					type: r.REQUEST_CONNECTION_STATUS,
					version: n.V2
				});
			} catch (e) {
				console.error(e);
			}
			return e.isConnected;
		})()), u = async (e) => {
			if (!d) return Promise.resolve(null);
			let t = ((n = window) == null || (r = n.sessionStorage) == null ? void 0 : r.getItem(i)) || "";
			var n, r;
			let a = await o(e, t, "message");
			return {
				signedMessage: a.signedData,
				signerAddress: a.signerAddress
			};
		}, d = typeof window < "u", f = {
			getPublicKey: s,
			signTransaction: c,
			isConnected: l,
			signMessage: u
		};
		return t;
	})());
})), Es, Ds, Os, ks = t((() => {
	Es = Ts(), q(), Ma(), Ds = "lobstr", Os = class {
		moduleType = K.HOT_WALLET;
		productId = Ds;
		productName = "LOBSTR";
		productUrl = "https://lobstr.co";
		productIcon = "https://stellar.creit.tech/wallet-icons/lobstr.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Lobstr is not connected");
		}
		async isAvailable() {
			return (0, Es.isConnected)();
		}
		async getAddress() {
			try {
				return await this.runChecks(), { address: await (0, Es.getPublicKey)() };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			t?.address && console.warn("Lobstr doesn't allow specifying what public key should sign the transaction, we skip the value"), t?.networkPassphrase && console.warn("Lobstr doesn't allow specifying the network that should be used, we skip the value");
			try {
				return await this.runChecks(), { signedTxXdr: await (0, Es.signTransaction)(e) };
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			t?.address && console.warn("Lobstr doesn't allow specifying what public key should sign the transaction, we skip the value"), t?.networkPassphrase && console.warn("Lobstr doesn't allow specifying the network that should be used, we skip the value");
			try {
				await this.runChecks();
				let t = await (0, Es.signMessage)(e);
				if (!t) throw Error("Signing message failed");
				return t;
			} catch (e) {
				throw $(e);
			}
		}
		signAuthEntry() {
			return Promise.reject({
				code: -3,
				message: "Lobstr does not support the \"signAuthEntry\" function"
			});
		}
		getNetwork() {
			return Promise.reject({
				code: -3,
				message: "Lobstr does not support the \"getNetwork\" function"
			});
		}
	};
})), As, js, Ms, Ns = t((() => {
	q(), Ma(), As = "rabet", js = class {
		moduleType = K.HOT_WALLET;
		productId = As;
		productName = "Rabet";
		productUrl = "https://rabet.io/";
		productIcon = "https://stellar.creit.tech/wallet-icons/rabet.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Rabet is not installed");
		}
		isAvailable() {
			return new Promise((e) => {
				setTimeout(() => {
					e(typeof window < "u" && !!window.rabet);
				}, 100);
			});
		}
		async getAddress() {
			try {
				await this.runChecks();
				let { publicKey: e } = await window.rabet.connect();
				return { address: e };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			if (t?.networkPassphrase && t.networkPassphrase !== G.PUBLIC && t.networkPassphrase !== G.TESTNET) throw Error(`Rabet doesn't support the network: ${t.networkPassphrase}`);
			t?.address && console.warn("Rabet doesn't allow specifying the network that should be used, we skip the value");
			try {
				return await this.runChecks(), { signedTxXdr: (await window.rabet.sign(e, t?.networkPassphrase === G.PUBLIC ? Ms.PUBLIC : Ms.TESTNET))?.xdr };
			} catch (e) {
				throw $(e);
			}
		}
		signAuthEntry() {
			return Promise.reject({
				code: -3,
				message: "Rabet does not support the \"signAuthEntry\" function"
			});
		}
		signMessage() {
			return Promise.reject({
				code: -3,
				message: "Rabet does not support the \"signMessage\" function"
			});
		}
		getNetwork() {
			return Promise.reject({
				code: -3,
				message: "Rabet does not support the \"getNetwork\" function"
			});
		}
	}, Ms = /*#__PURE__*/ function(e) {
		return e.PUBLIC = "mainnet", e.TESTNET = "testnet", e;
	}({});
})), Ps = /* @__PURE__ */ n(((e, t) => {
	t.exports = {};
})), Fs = /* @__PURE__ */ n(((e, t) => {
	(function(e) {
		var t = function(e) {
			var t, n = /* @__PURE__ */ new Float64Array(16);
			if (e) for (t = 0; t < e.length; t++) n[t] = e[t];
			return n;
		}, n = function() {
			throw Error("no PRNG");
		}, r = /* @__PURE__ */ new Uint8Array(16), a = /* @__PURE__ */ new Uint8Array(32);
		a[0] = 9;
		var o = t(), s = t([1]), c = t([56129, 1]), l = t([
			30883,
			4953,
			19914,
			30187,
			55467,
			16705,
			2637,
			112,
			59544,
			30585,
			16505,
			36039,
			65139,
			11119,
			27886,
			20995
		]), u = t([
			61785,
			9906,
			39828,
			60374,
			45398,
			33411,
			5274,
			224,
			53552,
			61171,
			33010,
			6542,
			64743,
			22239,
			55772,
			9222
		]), d = t([
			54554,
			36645,
			11616,
			51542,
			42930,
			38181,
			51040,
			26924,
			56412,
			64982,
			57905,
			49316,
			21502,
			52590,
			14035,
			8553
		]), f = t([
			26200,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214,
			26214
		]), p = t([
			41136,
			18958,
			6951,
			50414,
			58488,
			44335,
			6150,
			12099,
			55207,
			15867,
			153,
			11085,
			57099,
			20417,
			9344,
			11139
		]);
		function m(e, t, n, r) {
			e[t] = n >> 24 & 255, e[t + 1] = n >> 16 & 255, e[t + 2] = n >> 8 & 255, e[t + 3] = n & 255, e[t + 4] = r >> 24 & 255, e[t + 5] = r >> 16 & 255, e[t + 6] = r >> 8 & 255, e[t + 7] = r & 255;
		}
		function h(e, t, n, r, i) {
			var a, o = 0;
			for (a = 0; a < i; a++) o |= e[t + a] ^ n[r + a];
			return (1 & o - 1 >>> 8) - 1;
		}
		function g(e, t, n, r) {
			return h(e, t, n, r, 16);
		}
		function _(e, t, n, r) {
			return h(e, t, n, r, 32);
		}
		function v(e, t, n, r) {
			for (var i = r[0] & 255 | (r[1] & 255) << 8 | (r[2] & 255) << 16 | (r[3] & 255) << 24, a = n[0] & 255 | (n[1] & 255) << 8 | (n[2] & 255) << 16 | (n[3] & 255) << 24, o = n[4] & 255 | (n[5] & 255) << 8 | (n[6] & 255) << 16 | (n[7] & 255) << 24, s = n[8] & 255 | (n[9] & 255) << 8 | (n[10] & 255) << 16 | (n[11] & 255) << 24, c = n[12] & 255 | (n[13] & 255) << 8 | (n[14] & 255) << 16 | (n[15] & 255) << 24, l = r[4] & 255 | (r[5] & 255) << 8 | (r[6] & 255) << 16 | (r[7] & 255) << 24, u = t[0] & 255 | (t[1] & 255) << 8 | (t[2] & 255) << 16 | (t[3] & 255) << 24, d = t[4] & 255 | (t[5] & 255) << 8 | (t[6] & 255) << 16 | (t[7] & 255) << 24, f = t[8] & 255 | (t[9] & 255) << 8 | (t[10] & 255) << 16 | (t[11] & 255) << 24, p = t[12] & 255 | (t[13] & 255) << 8 | (t[14] & 255) << 16 | (t[15] & 255) << 24, m = r[8] & 255 | (r[9] & 255) << 8 | (r[10] & 255) << 16 | (r[11] & 255) << 24, h = n[16] & 255 | (n[17] & 255) << 8 | (n[18] & 255) << 16 | (n[19] & 255) << 24, g = n[20] & 255 | (n[21] & 255) << 8 | (n[22] & 255) << 16 | (n[23] & 255) << 24, _ = n[24] & 255 | (n[25] & 255) << 8 | (n[26] & 255) << 16 | (n[27] & 255) << 24, v = n[28] & 255 | (n[29] & 255) << 8 | (n[30] & 255) << 16 | (n[31] & 255) << 24, y = r[12] & 255 | (r[13] & 255) << 8 | (r[14] & 255) << 16 | (r[15] & 255) << 24, b = i, x = a, S = o, C = s, w = c, T = l, E = u, D = d, O = f, k = p, A = m, j = h, M = g, N = _, P = v, F = y, I, L = 0; L < 20; L += 2) I = b + M | 0, w ^= I << 7 | I >>> 25, I = w + b | 0, O ^= I << 9 | I >>> 23, I = O + w | 0, M ^= I << 13 | I >>> 19, I = M + O | 0, b ^= I << 18 | I >>> 14, I = T + x | 0, k ^= I << 7 | I >>> 25, I = k + T | 0, N ^= I << 9 | I >>> 23, I = N + k | 0, x ^= I << 13 | I >>> 19, I = x + N | 0, T ^= I << 18 | I >>> 14, I = A + E | 0, P ^= I << 7 | I >>> 25, I = P + A | 0, S ^= I << 9 | I >>> 23, I = S + P | 0, E ^= I << 13 | I >>> 19, I = E + S | 0, A ^= I << 18 | I >>> 14, I = F + j | 0, C ^= I << 7 | I >>> 25, I = C + F | 0, D ^= I << 9 | I >>> 23, I = D + C | 0, j ^= I << 13 | I >>> 19, I = j + D | 0, F ^= I << 18 | I >>> 14, I = b + C | 0, x ^= I << 7 | I >>> 25, I = x + b | 0, S ^= I << 9 | I >>> 23, I = S + x | 0, C ^= I << 13 | I >>> 19, I = C + S | 0, b ^= I << 18 | I >>> 14, I = T + w | 0, E ^= I << 7 | I >>> 25, I = E + T | 0, D ^= I << 9 | I >>> 23, I = D + E | 0, w ^= I << 13 | I >>> 19, I = w + D | 0, T ^= I << 18 | I >>> 14, I = A + k | 0, j ^= I << 7 | I >>> 25, I = j + A | 0, O ^= I << 9 | I >>> 23, I = O + j | 0, k ^= I << 13 | I >>> 19, I = k + O | 0, A ^= I << 18 | I >>> 14, I = F + P | 0, M ^= I << 7 | I >>> 25, I = M + F | 0, N ^= I << 9 | I >>> 23, I = N + M | 0, P ^= I << 13 | I >>> 19, I = P + N | 0, F ^= I << 18 | I >>> 14;
			b = b + i | 0, x = x + a | 0, S = S + o | 0, C = C + s | 0, w = w + c | 0, T = T + l | 0, E = E + u | 0, D = D + d | 0, O = O + f | 0, k = k + p | 0, A = A + m | 0, j = j + h | 0, M = M + g | 0, N = N + _ | 0, P = P + v | 0, F = F + y | 0, e[0] = b >>> 0 & 255, e[1] = b >>> 8 & 255, e[2] = b >>> 16 & 255, e[3] = b >>> 24 & 255, e[4] = x >>> 0 & 255, e[5] = x >>> 8 & 255, e[6] = x >>> 16 & 255, e[7] = x >>> 24 & 255, e[8] = S >>> 0 & 255, e[9] = S >>> 8 & 255, e[10] = S >>> 16 & 255, e[11] = S >>> 24 & 255, e[12] = C >>> 0 & 255, e[13] = C >>> 8 & 255, e[14] = C >>> 16 & 255, e[15] = C >>> 24 & 255, e[16] = w >>> 0 & 255, e[17] = w >>> 8 & 255, e[18] = w >>> 16 & 255, e[19] = w >>> 24 & 255, e[20] = T >>> 0 & 255, e[21] = T >>> 8 & 255, e[22] = T >>> 16 & 255, e[23] = T >>> 24 & 255, e[24] = E >>> 0 & 255, e[25] = E >>> 8 & 255, e[26] = E >>> 16 & 255, e[27] = E >>> 24 & 255, e[28] = D >>> 0 & 255, e[29] = D >>> 8 & 255, e[30] = D >>> 16 & 255, e[31] = D >>> 24 & 255, e[32] = O >>> 0 & 255, e[33] = O >>> 8 & 255, e[34] = O >>> 16 & 255, e[35] = O >>> 24 & 255, e[36] = k >>> 0 & 255, e[37] = k >>> 8 & 255, e[38] = k >>> 16 & 255, e[39] = k >>> 24 & 255, e[40] = A >>> 0 & 255, e[41] = A >>> 8 & 255, e[42] = A >>> 16 & 255, e[43] = A >>> 24 & 255, e[44] = j >>> 0 & 255, e[45] = j >>> 8 & 255, e[46] = j >>> 16 & 255, e[47] = j >>> 24 & 255, e[48] = M >>> 0 & 255, e[49] = M >>> 8 & 255, e[50] = M >>> 16 & 255, e[51] = M >>> 24 & 255, e[52] = N >>> 0 & 255, e[53] = N >>> 8 & 255, e[54] = N >>> 16 & 255, e[55] = N >>> 24 & 255, e[56] = P >>> 0 & 255, e[57] = P >>> 8 & 255, e[58] = P >>> 16 & 255, e[59] = P >>> 24 & 255, e[60] = F >>> 0 & 255, e[61] = F >>> 8 & 255, e[62] = F >>> 16 & 255, e[63] = F >>> 24 & 255;
		}
		function y(e, t, n, r) {
			for (var i = r[0] & 255 | (r[1] & 255) << 8 | (r[2] & 255) << 16 | (r[3] & 255) << 24, a = n[0] & 255 | (n[1] & 255) << 8 | (n[2] & 255) << 16 | (n[3] & 255) << 24, o = n[4] & 255 | (n[5] & 255) << 8 | (n[6] & 255) << 16 | (n[7] & 255) << 24, s = n[8] & 255 | (n[9] & 255) << 8 | (n[10] & 255) << 16 | (n[11] & 255) << 24, c = n[12] & 255 | (n[13] & 255) << 8 | (n[14] & 255) << 16 | (n[15] & 255) << 24, l = r[4] & 255 | (r[5] & 255) << 8 | (r[6] & 255) << 16 | (r[7] & 255) << 24, u = t[0] & 255 | (t[1] & 255) << 8 | (t[2] & 255) << 16 | (t[3] & 255) << 24, d = t[4] & 255 | (t[5] & 255) << 8 | (t[6] & 255) << 16 | (t[7] & 255) << 24, f = t[8] & 255 | (t[9] & 255) << 8 | (t[10] & 255) << 16 | (t[11] & 255) << 24, p = t[12] & 255 | (t[13] & 255) << 8 | (t[14] & 255) << 16 | (t[15] & 255) << 24, m = r[8] & 255 | (r[9] & 255) << 8 | (r[10] & 255) << 16 | (r[11] & 255) << 24, h = n[16] & 255 | (n[17] & 255) << 8 | (n[18] & 255) << 16 | (n[19] & 255) << 24, g = n[20] & 255 | (n[21] & 255) << 8 | (n[22] & 255) << 16 | (n[23] & 255) << 24, _ = n[24] & 255 | (n[25] & 255) << 8 | (n[26] & 255) << 16 | (n[27] & 255) << 24, v = n[28] & 255 | (n[29] & 255) << 8 | (n[30] & 255) << 16 | (n[31] & 255) << 24, y = r[12] & 255 | (r[13] & 255) << 8 | (r[14] & 255) << 16 | (r[15] & 255) << 24, b = i, x = a, S = o, C = s, w = c, T = l, E = u, D = d, O = f, k = p, A = m, j = h, M = g, N = _, P = v, F = y, I, L = 0; L < 20; L += 2) I = b + M | 0, w ^= I << 7 | I >>> 25, I = w + b | 0, O ^= I << 9 | I >>> 23, I = O + w | 0, M ^= I << 13 | I >>> 19, I = M + O | 0, b ^= I << 18 | I >>> 14, I = T + x | 0, k ^= I << 7 | I >>> 25, I = k + T | 0, N ^= I << 9 | I >>> 23, I = N + k | 0, x ^= I << 13 | I >>> 19, I = x + N | 0, T ^= I << 18 | I >>> 14, I = A + E | 0, P ^= I << 7 | I >>> 25, I = P + A | 0, S ^= I << 9 | I >>> 23, I = S + P | 0, E ^= I << 13 | I >>> 19, I = E + S | 0, A ^= I << 18 | I >>> 14, I = F + j | 0, C ^= I << 7 | I >>> 25, I = C + F | 0, D ^= I << 9 | I >>> 23, I = D + C | 0, j ^= I << 13 | I >>> 19, I = j + D | 0, F ^= I << 18 | I >>> 14, I = b + C | 0, x ^= I << 7 | I >>> 25, I = x + b | 0, S ^= I << 9 | I >>> 23, I = S + x | 0, C ^= I << 13 | I >>> 19, I = C + S | 0, b ^= I << 18 | I >>> 14, I = T + w | 0, E ^= I << 7 | I >>> 25, I = E + T | 0, D ^= I << 9 | I >>> 23, I = D + E | 0, w ^= I << 13 | I >>> 19, I = w + D | 0, T ^= I << 18 | I >>> 14, I = A + k | 0, j ^= I << 7 | I >>> 25, I = j + A | 0, O ^= I << 9 | I >>> 23, I = O + j | 0, k ^= I << 13 | I >>> 19, I = k + O | 0, A ^= I << 18 | I >>> 14, I = F + P | 0, M ^= I << 7 | I >>> 25, I = M + F | 0, N ^= I << 9 | I >>> 23, I = N + M | 0, P ^= I << 13 | I >>> 19, I = P + N | 0, F ^= I << 18 | I >>> 14;
			e[0] = b >>> 0 & 255, e[1] = b >>> 8 & 255, e[2] = b >>> 16 & 255, e[3] = b >>> 24 & 255, e[4] = T >>> 0 & 255, e[5] = T >>> 8 & 255, e[6] = T >>> 16 & 255, e[7] = T >>> 24 & 255, e[8] = A >>> 0 & 255, e[9] = A >>> 8 & 255, e[10] = A >>> 16 & 255, e[11] = A >>> 24 & 255, e[12] = F >>> 0 & 255, e[13] = F >>> 8 & 255, e[14] = F >>> 16 & 255, e[15] = F >>> 24 & 255, e[16] = E >>> 0 & 255, e[17] = E >>> 8 & 255, e[18] = E >>> 16 & 255, e[19] = E >>> 24 & 255, e[20] = D >>> 0 & 255, e[21] = D >>> 8 & 255, e[22] = D >>> 16 & 255, e[23] = D >>> 24 & 255, e[24] = O >>> 0 & 255, e[25] = O >>> 8 & 255, e[26] = O >>> 16 & 255, e[27] = O >>> 24 & 255, e[28] = k >>> 0 & 255, e[29] = k >>> 8 & 255, e[30] = k >>> 16 & 255, e[31] = k >>> 24 & 255;
		}
		function b(e, t, n, r) {
			v(e, t, n, r);
		}
		function x(e, t, n, r) {
			y(e, t, n, r);
		}
		var S = new Uint8Array([
			101,
			120,
			112,
			97,
			110,
			100,
			32,
			51,
			50,
			45,
			98,
			121,
			116,
			101,
			32,
			107
		]);
		function C(e, t, n, r, i, a, o) {
			var s = /* @__PURE__ */ new Uint8Array(16), c = /* @__PURE__ */ new Uint8Array(64), l, u;
			for (u = 0; u < 16; u++) s[u] = 0;
			for (u = 0; u < 8; u++) s[u] = a[u];
			for (; i >= 64;) {
				for (b(c, s, o, S), u = 0; u < 64; u++) e[t + u] = n[r + u] ^ c[u];
				for (l = 1, u = 8; u < 16; u++) l = l + (s[u] & 255) | 0, s[u] = l & 255, l >>>= 8;
				i -= 64, t += 64, r += 64;
			}
			if (i > 0) for (b(c, s, o, S), u = 0; u < i; u++) e[t + u] = n[r + u] ^ c[u];
			return 0;
		}
		function w(e, t, n, r, i) {
			var a = /* @__PURE__ */ new Uint8Array(16), o = /* @__PURE__ */ new Uint8Array(64), s, c;
			for (c = 0; c < 16; c++) a[c] = 0;
			for (c = 0; c < 8; c++) a[c] = r[c];
			for (; n >= 64;) {
				for (b(o, a, i, S), c = 0; c < 64; c++) e[t + c] = o[c];
				for (s = 1, c = 8; c < 16; c++) s = s + (a[c] & 255) | 0, a[c] = s & 255, s >>>= 8;
				n -= 64, t += 64;
			}
			if (n > 0) for (b(o, a, i, S), c = 0; c < n; c++) e[t + c] = o[c];
			return 0;
		}
		function T(e, t, n, r, i) {
			var a = /* @__PURE__ */ new Uint8Array(32);
			x(a, r, i, S);
			for (var o = /* @__PURE__ */ new Uint8Array(8), s = 0; s < 8; s++) o[s] = r[s + 16];
			return w(e, t, n, o, a);
		}
		function E(e, t, n, r, i, a, o) {
			var s = /* @__PURE__ */ new Uint8Array(32);
			x(s, a, o, S);
			for (var c = /* @__PURE__ */ new Uint8Array(8), l = 0; l < 8; l++) c[l] = a[l + 16];
			return C(e, t, n, r, i, c, s);
		}
		var D = function(e) {
			this.buffer = /* @__PURE__ */ new Uint8Array(16), this.r = /* @__PURE__ */ new Uint16Array(10), this.h = /* @__PURE__ */ new Uint16Array(10), this.pad = /* @__PURE__ */ new Uint16Array(8), this.leftover = 0, this.fin = 0;
			var t = e[0] & 255 | (e[1] & 255) << 8, n, r, i, a, o, s, c;
			this.r[0] = t & 8191, n = e[2] & 255 | (e[3] & 255) << 8, this.r[1] = (t >>> 13 | n << 3) & 8191, r = e[4] & 255 | (e[5] & 255) << 8, this.r[2] = (n >>> 10 | r << 6) & 7939, i = e[6] & 255 | (e[7] & 255) << 8, this.r[3] = (r >>> 7 | i << 9) & 8191, a = e[8] & 255 | (e[9] & 255) << 8, this.r[4] = (i >>> 4 | a << 12) & 255, this.r[5] = a >>> 1 & 8190, o = e[10] & 255 | (e[11] & 255) << 8, this.r[6] = (a >>> 14 | o << 2) & 8191, s = e[12] & 255 | (e[13] & 255) << 8, this.r[7] = (o >>> 11 | s << 5) & 8065, c = e[14] & 255 | (e[15] & 255) << 8, this.r[8] = (s >>> 8 | c << 8) & 8191, this.r[9] = c >>> 5 & 127, this.pad[0] = e[16] & 255 | (e[17] & 255) << 8, this.pad[1] = e[18] & 255 | (e[19] & 255) << 8, this.pad[2] = e[20] & 255 | (e[21] & 255) << 8, this.pad[3] = e[22] & 255 | (e[23] & 255) << 8, this.pad[4] = e[24] & 255 | (e[25] & 255) << 8, this.pad[5] = e[26] & 255 | (e[27] & 255) << 8, this.pad[6] = e[28] & 255 | (e[29] & 255) << 8, this.pad[7] = e[30] & 255 | (e[31] & 255) << 8;
		};
		D.prototype.blocks = function(e, t, n) {
			for (var r = this.fin ? 0 : 2048, i, a, o, s, c, l, u, d, f, p, m, h, g, _, v, y, b, x, S, C = this.h[0], w = this.h[1], T = this.h[2], E = this.h[3], D = this.h[4], O = this.h[5], k = this.h[6], A = this.h[7], j = this.h[8], M = this.h[9], N = this.r[0], P = this.r[1], F = this.r[2], I = this.r[3], L = this.r[4], R = this.r[5], z = this.r[6], B = this.r[7], V = this.r[8], H = this.r[9]; n >= 16;) i = e[t + 0] & 255 | (e[t + 1] & 255) << 8, C += i & 8191, a = e[t + 2] & 255 | (e[t + 3] & 255) << 8, w += (i >>> 13 | a << 3) & 8191, o = e[t + 4] & 255 | (e[t + 5] & 255) << 8, T += (a >>> 10 | o << 6) & 8191, s = e[t + 6] & 255 | (e[t + 7] & 255) << 8, E += (o >>> 7 | s << 9) & 8191, c = e[t + 8] & 255 | (e[t + 9] & 255) << 8, D += (s >>> 4 | c << 12) & 8191, O += c >>> 1 & 8191, l = e[t + 10] & 255 | (e[t + 11] & 255) << 8, k += (c >>> 14 | l << 2) & 8191, u = e[t + 12] & 255 | (e[t + 13] & 255) << 8, A += (l >>> 11 | u << 5) & 8191, d = e[t + 14] & 255 | (e[t + 15] & 255) << 8, j += (u >>> 8 | d << 8) & 8191, M += d >>> 5 | r, f = 0, p = f, p += C * N, p += 5 * H * w, p += 5 * V * T, p += 5 * B * E, p += 5 * z * D, f = p >>> 13, p &= 8191, p += 5 * R * O, p += 5 * L * k, p += 5 * I * A, p += 5 * F * j, p += 5 * P * M, f += p >>> 13, p &= 8191, m = f, m += C * P, m += w * N, m += 5 * H * T, m += 5 * V * E, m += 5 * B * D, f = m >>> 13, m &= 8191, m += 5 * z * O, m += 5 * R * k, m += 5 * L * A, m += 5 * I * j, m += 5 * F * M, f += m >>> 13, m &= 8191, h = f, h += C * F, h += w * P, h += T * N, h += 5 * H * E, h += 5 * V * D, f = h >>> 13, h &= 8191, h += 5 * B * O, h += 5 * z * k, h += 5 * R * A, h += 5 * L * j, h += 5 * I * M, f += h >>> 13, h &= 8191, g = f, g += C * I, g += w * F, g += T * P, g += E * N, g += 5 * H * D, f = g >>> 13, g &= 8191, g += 5 * V * O, g += 5 * B * k, g += 5 * z * A, g += 5 * R * j, g += 5 * L * M, f += g >>> 13, g &= 8191, _ = f, _ += C * L, _ += w * I, _ += T * F, _ += E * P, _ += D * N, f = _ >>> 13, _ &= 8191, _ += 5 * H * O, _ += 5 * V * k, _ += 5 * B * A, _ += 5 * z * j, _ += 5 * R * M, f += _ >>> 13, _ &= 8191, v = f, v += C * R, v += w * L, v += T * I, v += E * F, v += D * P, f = v >>> 13, v &= 8191, v += O * N, v += 5 * H * k, v += 5 * V * A, v += 5 * B * j, v += 5 * z * M, f += v >>> 13, v &= 8191, y = f, y += C * z, y += w * R, y += T * L, y += E * I, y += D * F, f = y >>> 13, y &= 8191, y += O * P, y += k * N, y += 5 * H * A, y += 5 * V * j, y += 5 * B * M, f += y >>> 13, y &= 8191, b = f, b += C * B, b += w * z, b += T * R, b += E * L, b += D * I, f = b >>> 13, b &= 8191, b += O * F, b += k * P, b += A * N, b += 5 * H * j, b += 5 * V * M, f += b >>> 13, b &= 8191, x = f, x += C * V, x += w * B, x += T * z, x += E * R, x += D * L, f = x >>> 13, x &= 8191, x += O * I, x += k * F, x += A * P, x += j * N, x += 5 * H * M, f += x >>> 13, x &= 8191, S = f, S += C * H, S += w * V, S += T * B, S += E * z, S += D * R, f = S >>> 13, S &= 8191, S += O * L, S += k * I, S += A * F, S += j * P, S += M * N, f += S >>> 13, S &= 8191, f = (f << 2) + f | 0, f = f + p | 0, p = f & 8191, f >>>= 13, m += f, C = p, w = m, T = h, E = g, D = _, O = v, k = y, A = b, j = x, M = S, t += 16, n -= 16;
			this.h[0] = C, this.h[1] = w, this.h[2] = T, this.h[3] = E, this.h[4] = D, this.h[5] = O, this.h[6] = k, this.h[7] = A, this.h[8] = j, this.h[9] = M;
		}, D.prototype.finish = function(e, t) {
			var n = /* @__PURE__ */ new Uint16Array(10), r, i, a, o;
			if (this.leftover) {
				for (o = this.leftover, this.buffer[o++] = 1; o < 16; o++) this.buffer[o] = 0;
				this.fin = 1, this.blocks(this.buffer, 0, 16);
			}
			for (r = this.h[1] >>> 13, this.h[1] &= 8191, o = 2; o < 10; o++) this.h[o] += r, r = this.h[o] >>> 13, this.h[o] &= 8191;
			for (this.h[0] += r * 5, r = this.h[0] >>> 13, this.h[0] &= 8191, this.h[1] += r, r = this.h[1] >>> 13, this.h[1] &= 8191, this.h[2] += r, n[0] = this.h[0] + 5, r = n[0] >>> 13, n[0] &= 8191, o = 1; o < 10; o++) n[o] = this.h[o] + r, r = n[o] >>> 13, n[o] &= 8191;
			for (n[9] -= 8192, i = (r ^ 1) - 1, o = 0; o < 10; o++) n[o] &= i;
			for (i = ~i, o = 0; o < 10; o++) this.h[o] = this.h[o] & i | n[o];
			for (this.h[0] = (this.h[0] | this.h[1] << 13) & 65535, this.h[1] = (this.h[1] >>> 3 | this.h[2] << 10) & 65535, this.h[2] = (this.h[2] >>> 6 | this.h[3] << 7) & 65535, this.h[3] = (this.h[3] >>> 9 | this.h[4] << 4) & 65535, this.h[4] = (this.h[4] >>> 12 | this.h[5] << 1 | this.h[6] << 14) & 65535, this.h[5] = (this.h[6] >>> 2 | this.h[7] << 11) & 65535, this.h[6] = (this.h[7] >>> 5 | this.h[8] << 8) & 65535, this.h[7] = (this.h[8] >>> 8 | this.h[9] << 5) & 65535, a = this.h[0] + this.pad[0], this.h[0] = a & 65535, o = 1; o < 8; o++) a = (this.h[o] + this.pad[o] | 0) + (a >>> 16) | 0, this.h[o] = a & 65535;
			e[t + 0] = this.h[0] >>> 0 & 255, e[t + 1] = this.h[0] >>> 8 & 255, e[t + 2] = this.h[1] >>> 0 & 255, e[t + 3] = this.h[1] >>> 8 & 255, e[t + 4] = this.h[2] >>> 0 & 255, e[t + 5] = this.h[2] >>> 8 & 255, e[t + 6] = this.h[3] >>> 0 & 255, e[t + 7] = this.h[3] >>> 8 & 255, e[t + 8] = this.h[4] >>> 0 & 255, e[t + 9] = this.h[4] >>> 8 & 255, e[t + 10] = this.h[5] >>> 0 & 255, e[t + 11] = this.h[5] >>> 8 & 255, e[t + 12] = this.h[6] >>> 0 & 255, e[t + 13] = this.h[6] >>> 8 & 255, e[t + 14] = this.h[7] >>> 0 & 255, e[t + 15] = this.h[7] >>> 8 & 255;
		}, D.prototype.update = function(e, t, n) {
			var r, i;
			if (this.leftover) {
				for (i = 16 - this.leftover, i > n && (i = n), r = 0; r < i; r++) this.buffer[this.leftover + r] = e[t + r];
				if (n -= i, t += i, this.leftover += i, this.leftover < 16) return;
				this.blocks(this.buffer, 0, 16), this.leftover = 0;
			}
			if (n >= 16 && (i = n - n % 16, this.blocks(e, t, i), t += i, n -= i), n) {
				for (r = 0; r < n; r++) this.buffer[this.leftover + r] = e[t + r];
				this.leftover += n;
			}
		};
		function O(e, t, n, r, i, a) {
			var o = new D(a);
			return o.update(n, r, i), o.finish(e, t), 0;
		}
		function k(e, t, n, r, i, a) {
			var o = /* @__PURE__ */ new Uint8Array(16);
			return O(o, 0, n, r, i, a), g(e, t, o, 0);
		}
		function A(e, t, n, r, i) {
			var a;
			if (n < 32) return -1;
			for (E(e, 0, t, 0, n, r, i), O(e, 16, e, 32, n - 32, e), a = 0; a < 16; a++) e[a] = 0;
			return 0;
		}
		function j(e, t, n, r, i) {
			var a, o = /* @__PURE__ */ new Uint8Array(32);
			if (n < 32 || (T(o, 0, 32, r, i), k(t, 16, t, 32, n - 32, o) !== 0)) return -1;
			for (E(e, 0, t, 0, n, r, i), a = 0; a < 32; a++) e[a] = 0;
			return 0;
		}
		function M(e, t) {
			var n;
			for (n = 0; n < 16; n++) e[n] = t[n] | 0;
		}
		function N(e) {
			var t, n, r = 1;
			for (t = 0; t < 16; t++) n = e[t] + r + 65535, r = Math.floor(n / 65536), e[t] = n - r * 65536;
			e[0] += r - 1 + 37 * (r - 1);
		}
		function P(e, t, n) {
			for (var r, i = ~(n - 1), a = 0; a < 16; a++) r = i & (e[a] ^ t[a]), e[a] ^= r, t[a] ^= r;
		}
		function F(e, n) {
			var r, i, a, o = t(), s = t();
			for (r = 0; r < 16; r++) s[r] = n[r];
			for (N(s), N(s), N(s), i = 0; i < 2; i++) {
				for (o[0] = s[0] - 65517, r = 1; r < 15; r++) o[r] = s[r] - 65535 - (o[r - 1] >> 16 & 1), o[r - 1] &= 65535;
				o[15] = s[15] - 32767 - (o[14] >> 16 & 1), a = o[15] >> 16 & 1, o[14] &= 65535, P(s, o, 1 - a);
			}
			for (r = 0; r < 16; r++) e[2 * r] = s[r] & 255, e[2 * r + 1] = s[r] >> 8;
		}
		function I(e, t) {
			var n = /* @__PURE__ */ new Uint8Array(32), r = /* @__PURE__ */ new Uint8Array(32);
			return F(n, e), F(r, t), _(n, 0, r, 0);
		}
		function L(e) {
			var t = /* @__PURE__ */ new Uint8Array(32);
			return F(t, e), t[0] & 1;
		}
		function R(e, t) {
			var n;
			for (n = 0; n < 16; n++) e[n] = t[2 * n] + (t[2 * n + 1] << 8);
			e[15] &= 32767;
		}
		function z(e, t, n) {
			for (var r = 0; r < 16; r++) e[r] = t[r] + n[r];
		}
		function B(e, t, n) {
			for (var r = 0; r < 16; r++) e[r] = t[r] - n[r];
		}
		function V(e, t, n) {
			var r, i, a = 0, o = 0, s = 0, c = 0, l = 0, u = 0, d = 0, f = 0, p = 0, m = 0, h = 0, g = 0, _ = 0, v = 0, y = 0, b = 0, x = 0, S = 0, C = 0, w = 0, T = 0, E = 0, D = 0, O = 0, k = 0, A = 0, j = 0, M = 0, N = 0, P = 0, F = 0, I = n[0], L = n[1], R = n[2], z = n[3], B = n[4], V = n[5], H = n[6], ee = n[7], U = n[8], W = n[9], te = n[10], G = n[11], K = n[12], ne = n[13], q = n[14], re = n[15];
			r = t[0], a += r * I, o += r * L, s += r * R, c += r * z, l += r * B, u += r * V, d += r * H, f += r * ee, p += r * U, m += r * W, h += r * te, g += r * G, _ += r * K, v += r * ne, y += r * q, b += r * re, r = t[1], o += r * I, s += r * L, c += r * R, l += r * z, u += r * B, d += r * V, f += r * H, p += r * ee, m += r * U, h += r * W, g += r * te, _ += r * G, v += r * K, y += r * ne, b += r * q, x += r * re, r = t[2], s += r * I, c += r * L, l += r * R, u += r * z, d += r * B, f += r * V, p += r * H, m += r * ee, h += r * U, g += r * W, _ += r * te, v += r * G, y += r * K, b += r * ne, x += r * q, S += r * re, r = t[3], c += r * I, l += r * L, u += r * R, d += r * z, f += r * B, p += r * V, m += r * H, h += r * ee, g += r * U, _ += r * W, v += r * te, y += r * G, b += r * K, x += r * ne, S += r * q, C += r * re, r = t[4], l += r * I, u += r * L, d += r * R, f += r * z, p += r * B, m += r * V, h += r * H, g += r * ee, _ += r * U, v += r * W, y += r * te, b += r * G, x += r * K, S += r * ne, C += r * q, w += r * re, r = t[5], u += r * I, d += r * L, f += r * R, p += r * z, m += r * B, h += r * V, g += r * H, _ += r * ee, v += r * U, y += r * W, b += r * te, x += r * G, S += r * K, C += r * ne, w += r * q, T += r * re, r = t[6], d += r * I, f += r * L, p += r * R, m += r * z, h += r * B, g += r * V, _ += r * H, v += r * ee, y += r * U, b += r * W, x += r * te, S += r * G, C += r * K, w += r * ne, T += r * q, E += r * re, r = t[7], f += r * I, p += r * L, m += r * R, h += r * z, g += r * B, _ += r * V, v += r * H, y += r * ee, b += r * U, x += r * W, S += r * te, C += r * G, w += r * K, T += r * ne, E += r * q, D += r * re, r = t[8], p += r * I, m += r * L, h += r * R, g += r * z, _ += r * B, v += r * V, y += r * H, b += r * ee, x += r * U, S += r * W, C += r * te, w += r * G, T += r * K, E += r * ne, D += r * q, O += r * re, r = t[9], m += r * I, h += r * L, g += r * R, _ += r * z, v += r * B, y += r * V, b += r * H, x += r * ee, S += r * U, C += r * W, w += r * te, T += r * G, E += r * K, D += r * ne, O += r * q, k += r * re, r = t[10], h += r * I, g += r * L, _ += r * R, v += r * z, y += r * B, b += r * V, x += r * H, S += r * ee, C += r * U, w += r * W, T += r * te, E += r * G, D += r * K, O += r * ne, k += r * q, A += r * re, r = t[11], g += r * I, _ += r * L, v += r * R, y += r * z, b += r * B, x += r * V, S += r * H, C += r * ee, w += r * U, T += r * W, E += r * te, D += r * G, O += r * K, k += r * ne, A += r * q, j += r * re, r = t[12], _ += r * I, v += r * L, y += r * R, b += r * z, x += r * B, S += r * V, C += r * H, w += r * ee, T += r * U, E += r * W, D += r * te, O += r * G, k += r * K, A += r * ne, j += r * q, M += r * re, r = t[13], v += r * I, y += r * L, b += r * R, x += r * z, S += r * B, C += r * V, w += r * H, T += r * ee, E += r * U, D += r * W, O += r * te, k += r * G, A += r * K, j += r * ne, M += r * q, N += r * re, r = t[14], y += r * I, b += r * L, x += r * R, S += r * z, C += r * B, w += r * V, T += r * H, E += r * ee, D += r * U, O += r * W, k += r * te, A += r * G, j += r * K, M += r * ne, N += r * q, P += r * re, r = t[15], b += r * I, x += r * L, S += r * R, C += r * z, w += r * B, T += r * V, E += r * H, D += r * ee, O += r * U, k += r * W, A += r * te, j += r * G, M += r * K, N += r * ne, P += r * q, F += r * re, a += 38 * x, o += 38 * S, s += 38 * C, c += 38 * w, l += 38 * T, u += 38 * E, d += 38 * D, f += 38 * O, p += 38 * k, m += 38 * A, h += 38 * j, g += 38 * M, _ += 38 * N, v += 38 * P, y += 38 * F, i = 1, r = a + i + 65535, i = Math.floor(r / 65536), a = r - i * 65536, r = o + i + 65535, i = Math.floor(r / 65536), o = r - i * 65536, r = s + i + 65535, i = Math.floor(r / 65536), s = r - i * 65536, r = c + i + 65535, i = Math.floor(r / 65536), c = r - i * 65536, r = l + i + 65535, i = Math.floor(r / 65536), l = r - i * 65536, r = u + i + 65535, i = Math.floor(r / 65536), u = r - i * 65536, r = d + i + 65535, i = Math.floor(r / 65536), d = r - i * 65536, r = f + i + 65535, i = Math.floor(r / 65536), f = r - i * 65536, r = p + i + 65535, i = Math.floor(r / 65536), p = r - i * 65536, r = m + i + 65535, i = Math.floor(r / 65536), m = r - i * 65536, r = h + i + 65535, i = Math.floor(r / 65536), h = r - i * 65536, r = g + i + 65535, i = Math.floor(r / 65536), g = r - i * 65536, r = _ + i + 65535, i = Math.floor(r / 65536), _ = r - i * 65536, r = v + i + 65535, i = Math.floor(r / 65536), v = r - i * 65536, r = y + i + 65535, i = Math.floor(r / 65536), y = r - i * 65536, r = b + i + 65535, i = Math.floor(r / 65536), b = r - i * 65536, a += i - 1 + 37 * (i - 1), i = 1, r = a + i + 65535, i = Math.floor(r / 65536), a = r - i * 65536, r = o + i + 65535, i = Math.floor(r / 65536), o = r - i * 65536, r = s + i + 65535, i = Math.floor(r / 65536), s = r - i * 65536, r = c + i + 65535, i = Math.floor(r / 65536), c = r - i * 65536, r = l + i + 65535, i = Math.floor(r / 65536), l = r - i * 65536, r = u + i + 65535, i = Math.floor(r / 65536), u = r - i * 65536, r = d + i + 65535, i = Math.floor(r / 65536), d = r - i * 65536, r = f + i + 65535, i = Math.floor(r / 65536), f = r - i * 65536, r = p + i + 65535, i = Math.floor(r / 65536), p = r - i * 65536, r = m + i + 65535, i = Math.floor(r / 65536), m = r - i * 65536, r = h + i + 65535, i = Math.floor(r / 65536), h = r - i * 65536, r = g + i + 65535, i = Math.floor(r / 65536), g = r - i * 65536, r = _ + i + 65535, i = Math.floor(r / 65536), _ = r - i * 65536, r = v + i + 65535, i = Math.floor(r / 65536), v = r - i * 65536, r = y + i + 65535, i = Math.floor(r / 65536), y = r - i * 65536, r = b + i + 65535, i = Math.floor(r / 65536), b = r - i * 65536, a += i - 1 + 37 * (i - 1), e[0] = a, e[1] = o, e[2] = s, e[3] = c, e[4] = l, e[5] = u, e[6] = d, e[7] = f, e[8] = p, e[9] = m, e[10] = h, e[11] = g, e[12] = _, e[13] = v, e[14] = y, e[15] = b;
		}
		function H(e, t) {
			V(e, t, t);
		}
		function ee(e, n) {
			var r = t(), i;
			for (i = 0; i < 16; i++) r[i] = n[i];
			for (i = 253; i >= 0; i--) H(r, r), i !== 2 && i !== 4 && V(r, r, n);
			for (i = 0; i < 16; i++) e[i] = r[i];
		}
		function U(e, n) {
			var r = t(), i;
			for (i = 0; i < 16; i++) r[i] = n[i];
			for (i = 250; i >= 0; i--) H(r, r), i !== 1 && V(r, r, n);
			for (i = 0; i < 16; i++) e[i] = r[i];
		}
		function W(e, n, r) {
			var i = /* @__PURE__ */ new Uint8Array(32), a = /* @__PURE__ */ new Float64Array(80), o, s, l = t(), u = t(), d = t(), f = t(), p = t(), m = t();
			for (s = 0; s < 31; s++) i[s] = n[s];
			for (i[31] = n[31] & 127 | 64, i[0] &= 248, R(a, r), s = 0; s < 16; s++) u[s] = a[s], f[s] = l[s] = d[s] = 0;
			for (l[0] = f[0] = 1, s = 254; s >= 0; --s) o = i[s >>> 3] >>> (s & 7) & 1, P(l, u, o), P(d, f, o), z(p, l, d), B(l, l, d), z(d, u, f), B(u, u, f), H(f, p), H(m, l), V(l, d, l), V(d, u, p), z(p, l, d), B(l, l, d), H(u, l), B(d, f, m), V(l, d, c), z(l, l, f), V(d, d, l), V(l, f, m), V(f, u, a), H(u, p), P(l, u, o), P(d, f, o);
			for (s = 0; s < 16; s++) a[s + 16] = l[s], a[s + 32] = d[s], a[s + 48] = u[s], a[s + 64] = f[s];
			var h = a.subarray(32), g = a.subarray(16);
			return ee(h, h), V(g, g, h), F(e, g), 0;
		}
		function te(e, t) {
			return W(e, t, a);
		}
		function G(e, t) {
			return n(t, 32), te(e, t);
		}
		function K(e, t, n) {
			var i = /* @__PURE__ */ new Uint8Array(32);
			return W(i, n, t), x(e, r, i, S);
		}
		var ne = A, q = j;
		function re(e, t, n, r, i, a) {
			var o = /* @__PURE__ */ new Uint8Array(32);
			return K(o, i, a), ne(e, t, n, r, o);
		}
		function ie(e, t, n, r, i, a) {
			var o = /* @__PURE__ */ new Uint8Array(32);
			return K(o, i, a), q(e, t, n, r, o);
		}
		var ae = [
			1116352408,
			3609767458,
			1899447441,
			602891725,
			3049323471,
			3964484399,
			3921009573,
			2173295548,
			961987163,
			4081628472,
			1508970993,
			3053834265,
			2453635748,
			2937671579,
			2870763221,
			3664609560,
			3624381080,
			2734883394,
			310598401,
			1164996542,
			607225278,
			1323610764,
			1426881987,
			3590304994,
			1925078388,
			4068182383,
			2162078206,
			991336113,
			2614888103,
			633803317,
			3248222580,
			3479774868,
			3835390401,
			2666613458,
			4022224774,
			944711139,
			264347078,
			2341262773,
			604807628,
			2007800933,
			770255983,
			1495990901,
			1249150122,
			1856431235,
			1555081692,
			3175218132,
			1996064986,
			2198950837,
			2554220882,
			3999719339,
			2821834349,
			766784016,
			2952996808,
			2566594879,
			3210313671,
			3203337956,
			3336571891,
			1034457026,
			3584528711,
			2466948901,
			113926993,
			3758326383,
			338241895,
			168717936,
			666307205,
			1188179964,
			773529912,
			1546045734,
			1294757372,
			1522805485,
			1396182291,
			2643833823,
			1695183700,
			2343527390,
			1986661051,
			1014477480,
			2177026350,
			1206759142,
			2456956037,
			344077627,
			2730485921,
			1290863460,
			2820302411,
			3158454273,
			3259730800,
			3505952657,
			3345764771,
			106217008,
			3516065817,
			3606008344,
			3600352804,
			1432725776,
			4094571909,
			1467031594,
			275423344,
			851169720,
			430227734,
			3100823752,
			506948616,
			1363258195,
			659060556,
			3750685593,
			883997877,
			3785050280,
			958139571,
			3318307427,
			1322822218,
			3812723403,
			1537002063,
			2003034995,
			1747873779,
			3602036899,
			1955562222,
			1575990012,
			2024104815,
			1125592928,
			2227730452,
			2716904306,
			2361852424,
			442776044,
			2428436474,
			593698344,
			2756734187,
			3733110249,
			3204031479,
			2999351573,
			3329325298,
			3815920427,
			3391569614,
			3928383900,
			3515267271,
			566280711,
			3940187606,
			3454069534,
			4118630271,
			4000239992,
			116418474,
			1914138554,
			174292421,
			2731055270,
			289380356,
			3203993006,
			460393269,
			320620315,
			685471733,
			587496836,
			852142971,
			1086792851,
			1017036298,
			365543100,
			1126000580,
			2618297676,
			1288033470,
			3409855158,
			1501505948,
			4234509866,
			1607167915,
			987167468,
			1816402316,
			1246189591
		];
		function oe(e, t, n, r) {
			for (var i = /* @__PURE__ */ new Int32Array(16), a = /* @__PURE__ */ new Int32Array(16), o, s, c, l, u, d, f, p, m, h, g, _, v, y, b, x, S, C, w, T, E, D, O, k, A, j, M = e[0], N = e[1], P = e[2], F = e[3], I = e[4], L = e[5], R = e[6], z = e[7], B = t[0], V = t[1], H = t[2], ee = t[3], U = t[4], W = t[5], te = t[6], G = t[7], K = 0; r >= 128;) {
				for (w = 0; w < 16; w++) T = 8 * w + K, i[w] = n[T + 0] << 24 | n[T + 1] << 16 | n[T + 2] << 8 | n[T + 3], a[w] = n[T + 4] << 24 | n[T + 5] << 16 | n[T + 6] << 8 | n[T + 7];
				for (w = 0; w < 80; w++) if (o = M, s = N, c = P, l = F, u = I, d = L, f = R, p = z, m = B, h = V, g = H, _ = ee, v = U, y = W, b = te, x = G, E = z, D = G, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = (I >>> 14 | U << 18) ^ (I >>> 18 | U << 14) ^ (U >>> 9 | I << 23), D = (U >>> 14 | I << 18) ^ (U >>> 18 | I << 14) ^ (I >>> 9 | U << 23), O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, E = I & L ^ ~I & R, D = U & W ^ ~U & te, O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, E = ae[w * 2], D = ae[w * 2 + 1], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, E = i[w % 16], D = a[w % 16], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, S = A & 65535 | j << 16, C = O & 65535 | k << 16, E = S, D = C, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = (M >>> 28 | B << 4) ^ (B >>> 2 | M << 30) ^ (B >>> 7 | M << 25), D = (B >>> 28 | M << 4) ^ (M >>> 2 | B << 30) ^ (M >>> 7 | B << 25), O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, E = M & N ^ M & P ^ N & P, D = B & V ^ B & H ^ V & H, O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, p = A & 65535 | j << 16, x = O & 65535 | k << 16, E = l, D = _, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = S, D = C, O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, l = A & 65535 | j << 16, _ = O & 65535 | k << 16, N = o, P = s, F = c, I = l, L = u, R = d, z = f, M = p, V = m, H = h, ee = g, U = _, W = v, te = y, G = b, B = x, w % 16 == 15) for (T = 0; T < 16; T++) E = i[T], D = a[T], O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = i[(T + 9) % 16], D = a[(T + 9) % 16], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, S = i[(T + 1) % 16], C = a[(T + 1) % 16], E = (S >>> 1 | C << 31) ^ (S >>> 8 | C << 24) ^ S >>> 7, D = (C >>> 1 | S << 31) ^ (C >>> 8 | S << 24) ^ (C >>> 7 | S << 25), O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, S = i[(T + 14) % 16], C = a[(T + 14) % 16], E = (S >>> 19 | C << 13) ^ (C >>> 29 | S << 3) ^ S >>> 6, D = (C >>> 19 | S << 13) ^ (S >>> 29 | C << 3) ^ (C >>> 6 | S << 26), O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, i[T] = A & 65535 | j << 16, a[T] = O & 65535 | k << 16;
				E = M, D = B, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[0], D = t[0], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[0] = M = A & 65535 | j << 16, t[0] = B = O & 65535 | k << 16, E = N, D = V, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[1], D = t[1], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[1] = N = A & 65535 | j << 16, t[1] = V = O & 65535 | k << 16, E = P, D = H, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[2], D = t[2], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[2] = P = A & 65535 | j << 16, t[2] = H = O & 65535 | k << 16, E = F, D = ee, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[3], D = t[3], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[3] = F = A & 65535 | j << 16, t[3] = ee = O & 65535 | k << 16, E = I, D = U, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[4], D = t[4], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[4] = I = A & 65535 | j << 16, t[4] = U = O & 65535 | k << 16, E = L, D = W, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[5], D = t[5], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[5] = L = A & 65535 | j << 16, t[5] = W = O & 65535 | k << 16, E = R, D = te, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[6], D = t[6], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[6] = R = A & 65535 | j << 16, t[6] = te = O & 65535 | k << 16, E = z, D = G, O = D & 65535, k = D >>> 16, A = E & 65535, j = E >>> 16, E = e[7], D = t[7], O += D & 65535, k += D >>> 16, A += E & 65535, j += E >>> 16, k += O >>> 16, A += k >>> 16, j += A >>> 16, e[7] = z = A & 65535 | j << 16, t[7] = G = O & 65535 | k << 16, K += 128, r -= 128;
			}
			return r;
		}
		function se(e, t, n) {
			var r = /* @__PURE__ */ new Int32Array(8), i = /* @__PURE__ */ new Int32Array(8), a = /* @__PURE__ */ new Uint8Array(256), o, s = n;
			for (r[0] = 1779033703, r[1] = 3144134277, r[2] = 1013904242, r[3] = 2773480762, r[4] = 1359893119, r[5] = 2600822924, r[6] = 528734635, r[7] = 1541459225, i[0] = 4089235720, i[1] = 2227873595, i[2] = 4271175723, i[3] = 1595750129, i[4] = 2917565137, i[5] = 725511199, i[6] = 4215389547, i[7] = 327033209, oe(r, i, t, n), n %= 128, o = 0; o < n; o++) a[o] = t[s - n + o];
			for (a[n] = 128, n = 256 - 128 * (n < 112), a[n - 9] = 0, m(a, n - 8, s / 536870912 | 0, s << 3), oe(r, i, a, n), o = 0; o < 8; o++) m(e, 8 * o, r[o], i[o]);
			return 0;
		}
		function ce(e, n) {
			var r = t(), i = t(), a = t(), o = t(), s = t(), c = t(), l = t(), d = t(), f = t();
			B(r, e[1], e[0]), B(f, n[1], n[0]), V(r, r, f), z(i, e[0], e[1]), z(f, n[0], n[1]), V(i, i, f), V(a, e[3], n[3]), V(a, a, u), V(o, e[2], n[2]), z(o, o, o), B(s, i, r), B(c, o, a), z(l, o, a), z(d, i, r), V(e[0], s, c), V(e[1], d, l), V(e[2], l, c), V(e[3], s, d);
		}
		function le(e, t, n) {
			var r;
			for (r = 0; r < 4; r++) P(e[r], t[r], n);
		}
		function ue(e, n) {
			var r = t(), i = t(), a = t();
			ee(a, n[2]), V(r, n[0], a), V(i, n[1], a), F(e, i), e[31] ^= L(r) << 7;
		}
		function de(e, t, n) {
			var r, i;
			for (M(e[0], o), M(e[1], s), M(e[2], s), M(e[3], o), i = 255; i >= 0; --i) r = n[i / 8 | 0] >> (i & 7) & 1, le(e, t, r), ce(t, e), ce(e, e), le(e, t, r);
		}
		function fe(e, n) {
			var r = [
				t(),
				t(),
				t(),
				t()
			];
			M(r[0], d), M(r[1], f), M(r[2], s), V(r[3], d, f), de(e, r, n);
		}
		function pe(e, r, i) {
			var a = /* @__PURE__ */ new Uint8Array(64), o = [
				t(),
				t(),
				t(),
				t()
			], s;
			for (i || n(r, 32), se(a, r, 32), a[0] &= 248, a[31] &= 127, a[31] |= 64, fe(o, a), ue(e, o), s = 0; s < 32; s++) r[s + 32] = e[s];
			return 0;
		}
		var me = new Float64Array([
			237,
			211,
			245,
			92,
			26,
			99,
			18,
			88,
			214,
			156,
			247,
			162,
			222,
			249,
			222,
			20,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			16
		]);
		function he(e, t) {
			var n, r, i, a;
			for (r = 63; r >= 32; --r) {
				for (n = 0, i = r - 32, a = r - 12; i < a; ++i) t[i] += n - 16 * t[r] * me[i - (r - 32)], n = Math.floor((t[i] + 128) / 256), t[i] -= n * 256;
				t[i] += n, t[r] = 0;
			}
			for (n = 0, i = 0; i < 32; i++) t[i] += n - (t[31] >> 4) * me[i], n = t[i] >> 8, t[i] &= 255;
			for (i = 0; i < 32; i++) t[i] -= n * me[i];
			for (r = 0; r < 32; r++) t[r + 1] += t[r] >> 8, e[r] = t[r] & 255;
		}
		function ge(e) {
			var t = /* @__PURE__ */ new Float64Array(64), n;
			for (n = 0; n < 64; n++) t[n] = e[n];
			for (n = 0; n < 64; n++) e[n] = 0;
			he(e, t);
		}
		function _e(e, n, r, i) {
			var a = /* @__PURE__ */ new Uint8Array(64), o = /* @__PURE__ */ new Uint8Array(64), s = /* @__PURE__ */ new Uint8Array(64), c, l, u = /* @__PURE__ */ new Float64Array(64), d = [
				t(),
				t(),
				t(),
				t()
			];
			se(a, i, 32), a[0] &= 248, a[31] &= 127, a[31] |= 64;
			var f = r + 64;
			for (c = 0; c < r; c++) e[64 + c] = n[c];
			for (c = 0; c < 32; c++) e[32 + c] = a[32 + c];
			for (se(s, e.subarray(32), r + 32), ge(s), fe(d, s), ue(e, d), c = 32; c < 64; c++) e[c] = i[c];
			for (se(o, e, r + 64), ge(o), c = 0; c < 64; c++) u[c] = 0;
			for (c = 0; c < 32; c++) u[c] = s[c];
			for (c = 0; c < 32; c++) for (l = 0; l < 32; l++) u[c + l] += o[c] * a[l];
			return he(e.subarray(32), u), f;
		}
		function ve(e, n) {
			var r = t(), i = t(), a = t(), c = t(), u = t(), d = t(), f = t();
			return M(e[2], s), R(e[1], n), H(a, e[1]), V(c, a, l), B(a, a, e[2]), z(c, e[2], c), H(u, c), H(d, u), V(f, d, u), V(r, f, a), V(r, r, c), U(r, r), V(r, r, a), V(r, r, c), V(r, r, c), V(e[0], r, c), H(i, e[0]), V(i, i, c), I(i, a) && V(e[0], e[0], p), H(i, e[0]), V(i, i, c), I(i, a) ? -1 : (L(e[0]) === n[31] >> 7 && B(e[0], o, e[0]), V(e[3], e[0], e[1]), 0);
		}
		function ye(e, n, r, i) {
			var a, o = /* @__PURE__ */ new Uint8Array(32), s = /* @__PURE__ */ new Uint8Array(64), c = [
				t(),
				t(),
				t(),
				t()
			], l = [
				t(),
				t(),
				t(),
				t()
			];
			if (r < 64 || ve(l, i)) return -1;
			for (a = 0; a < r; a++) e[a] = n[a];
			for (a = 0; a < 32; a++) e[a + 32] = i[a];
			if (se(s, e, r), ge(s), de(c, l, s), fe(l, n.subarray(32)), ce(c, l), ue(o, c), r -= 64, _(n, 0, o, 0)) {
				for (a = 0; a < r; a++) e[a] = 0;
				return -1;
			}
			for (a = 0; a < r; a++) e[a] = n[a + 64];
			return r;
		}
		var be = 32, xe = 24, Se = 32, Ce = 16, we = 32, Te = 32, Ee = 32, De = 32, Oe = 32, ke = xe, Ae = Se, je = Ce, Me = 64, Ne = 32, Pe = 64, Fe = 32, Ie = 64;
		e.lowlevel = {
			crypto_core_hsalsa20: x,
			crypto_stream_xor: E,
			crypto_stream: T,
			crypto_stream_salsa20_xor: C,
			crypto_stream_salsa20: w,
			crypto_onetimeauth: O,
			crypto_onetimeauth_verify: k,
			crypto_verify_16: g,
			crypto_verify_32: _,
			crypto_secretbox: A,
			crypto_secretbox_open: j,
			crypto_scalarmult: W,
			crypto_scalarmult_base: te,
			crypto_box_beforenm: K,
			crypto_box_afternm: ne,
			crypto_box: re,
			crypto_box_open: ie,
			crypto_box_keypair: G,
			crypto_hash: se,
			crypto_sign: _e,
			crypto_sign_keypair: pe,
			crypto_sign_open: ye,
			crypto_secretbox_KEYBYTES: be,
			crypto_secretbox_NONCEBYTES: xe,
			crypto_secretbox_ZEROBYTES: Se,
			crypto_secretbox_BOXZEROBYTES: Ce,
			crypto_scalarmult_BYTES: we,
			crypto_scalarmult_SCALARBYTES: Te,
			crypto_box_PUBLICKEYBYTES: Ee,
			crypto_box_SECRETKEYBYTES: De,
			crypto_box_BEFORENMBYTES: Oe,
			crypto_box_NONCEBYTES: ke,
			crypto_box_ZEROBYTES: Ae,
			crypto_box_BOXZEROBYTES: je,
			crypto_sign_BYTES: Me,
			crypto_sign_PUBLICKEYBYTES: Ne,
			crypto_sign_SECRETKEYBYTES: Pe,
			crypto_sign_SEEDBYTES: Fe,
			crypto_hash_BYTES: Ie,
			gf: t,
			D: l,
			L: me,
			pack25519: F,
			unpack25519: R,
			M: V,
			A: z,
			S: H,
			Z: B,
			pow2523: U,
			add: ce,
			set25519: M,
			modL: he,
			scalarmult: de,
			scalarbase: fe
		};
		function J(e, t) {
			if (e.length !== be) throw Error("bad key size");
			if (t.length !== xe) throw Error("bad nonce size");
		}
		function Le(e, t) {
			if (e.length !== Ee) throw Error("bad public key size");
			if (t.length !== De) throw Error("bad secret key size");
		}
		function Re() {
			for (var e = 0; e < arguments.length; e++) if (!(arguments[e] instanceof Uint8Array)) throw TypeError("unexpected type, use Uint8Array");
		}
		function ze(e) {
			for (var t = 0; t < e.length; t++) e[t] = 0;
		}
		e.randomBytes = function(e) {
			var t = new Uint8Array(e);
			return n(t, e), t;
		}, e.secretbox = function(e, t, n) {
			Re(e, t, n), J(n, t);
			for (var r = new Uint8Array(Se + e.length), i = new Uint8Array(r.length), a = 0; a < e.length; a++) r[a + Se] = e[a];
			return A(i, r, r.length, t, n), i.subarray(Ce);
		}, e.secretbox.open = function(e, t, n) {
			Re(e, t, n), J(n, t);
			for (var r = new Uint8Array(Ce + e.length), i = new Uint8Array(r.length), a = 0; a < e.length; a++) r[a + Ce] = e[a];
			return r.length < 32 || j(i, r, r.length, t, n) !== 0 ? null : i.subarray(Se);
		}, e.secretbox.keyLength = be, e.secretbox.nonceLength = xe, e.secretbox.overheadLength = Ce, e.scalarMult = function(e, t) {
			if (Re(e, t), e.length !== Te) throw Error("bad n size");
			if (t.length !== we) throw Error("bad p size");
			var n = new Uint8Array(we);
			return W(n, e, t), n;
		}, e.scalarMult.base = function(e) {
			if (Re(e), e.length !== Te) throw Error("bad n size");
			var t = new Uint8Array(we);
			return te(t, e), t;
		}, e.scalarMult.scalarLength = Te, e.scalarMult.groupElementLength = we, e.box = function(t, n, r, i) {
			var a = e.box.before(r, i);
			return e.secretbox(t, n, a);
		}, e.box.before = function(e, t) {
			Re(e, t), Le(e, t);
			var n = new Uint8Array(Oe);
			return K(n, e, t), n;
		}, e.box.after = e.secretbox, e.box.open = function(t, n, r, i) {
			var a = e.box.before(r, i);
			return e.secretbox.open(t, n, a);
		}, e.box.open.after = e.secretbox.open, e.box.keyPair = function() {
			var e = new Uint8Array(Ee), t = new Uint8Array(De);
			return G(e, t), {
				publicKey: e,
				secretKey: t
			};
		}, e.box.keyPair.fromSecretKey = function(e) {
			if (Re(e), e.length !== De) throw Error("bad secret key size");
			var t = new Uint8Array(Ee);
			return te(t, e), {
				publicKey: t,
				secretKey: new Uint8Array(e)
			};
		}, e.box.publicKeyLength = Ee, e.box.secretKeyLength = De, e.box.sharedKeyLength = Oe, e.box.nonceLength = ke, e.box.overheadLength = e.secretbox.overheadLength, e.sign = function(e, t) {
			if (Re(e, t), t.length !== Pe) throw Error("bad secret key size");
			var n = new Uint8Array(Me + e.length);
			return _e(n, e, e.length, t), n;
		}, e.sign.open = function(e, t) {
			if (Re(e, t), t.length !== Ne) throw Error("bad public key size");
			var n = new Uint8Array(e.length), r = ye(n, e, e.length, t);
			if (r < 0) return null;
			for (var i = new Uint8Array(r), a = 0; a < i.length; a++) i[a] = n[a];
			return i;
		}, e.sign.detached = function(t, n) {
			for (var r = e.sign(t, n), i = new Uint8Array(Me), a = 0; a < i.length; a++) i[a] = r[a];
			return i;
		}, e.sign.detached.verify = function(e, t, n) {
			if (Re(e, t, n), t.length !== Me) throw Error("bad signature size");
			if (n.length !== Ne) throw Error("bad public key size");
			var r = new Uint8Array(Me + e.length), i = new Uint8Array(Me + e.length), a;
			for (a = 0; a < Me; a++) r[a] = t[a];
			for (a = 0; a < e.length; a++) r[a + Me] = e[a];
			return ye(i, r, r.length, n) >= 0;
		}, e.sign.keyPair = function() {
			var e = new Uint8Array(Ne), t = new Uint8Array(Pe);
			return pe(e, t), {
				publicKey: e,
				secretKey: t
			};
		}, e.sign.keyPair.fromSecretKey = function(e) {
			if (Re(e), e.length !== Pe) throw Error("bad secret key size");
			for (var t = new Uint8Array(Ne), n = 0; n < t.length; n++) t[n] = e[32 + n];
			return {
				publicKey: t,
				secretKey: new Uint8Array(e)
			};
		}, e.sign.keyPair.fromSeed = function(e) {
			if (Re(e), e.length !== Fe) throw Error("bad seed size");
			for (var t = new Uint8Array(Ne), n = new Uint8Array(Pe), r = 0; r < 32; r++) n[r] = e[r];
			return pe(t, n, !0), {
				publicKey: t,
				secretKey: n
			};
		}, e.sign.publicKeyLength = Ne, e.sign.secretKeyLength = Pe, e.sign.seedLength = Fe, e.sign.signatureLength = Me, e.hash = function(e) {
			Re(e);
			var t = new Uint8Array(Ie);
			return se(t, e, e.length), t;
		}, e.hash.hashLength = Ie, e.verify = function(e, t) {
			return Re(e, t), e.length === 0 || t.length === 0 || e.length !== t.length ? !1 : h(e, 0, t, 0, e.length) === 0;
		}, e.setPRNG = function(e) {
			n = e;
		}, (function() {
			var t = typeof self < "u" ? self.crypto || self.msCrypto : null;
			if (t && t.getRandomValues) {
				var n = 65536;
				e.setPRNG(function(e, r) {
					var i, a = new Uint8Array(r);
					for (i = 0; i < r; i += n) t.getRandomValues(a.subarray(i, i + Math.min(r - i, n)));
					for (i = 0; i < r; i++) e[i] = a[i];
					ze(a);
				});
			} else i !== void 0 && (t = Ps(), t && t.randomBytes && e.setPRNG(function(e, n) {
				var r, i = t.randomBytes(n);
				for (r = 0; r < n; r++) e[r] = i[r];
				ze(i);
			}));
		})();
	})(t !== void 0 && t.exports ? t.exports : self.nacl = self.nacl || {});
})), Is = /* @__PURE__ */ n(((e, t) => {
	(function(e, n) {
		t !== void 0 && t.exports ? t.exports = n() : (e.nacl ||= {}, e.nacl.util = n());
	})(e, function() {
		var e = {};
		function t(e) {
			if (!/^(?:[A-Za-z0-9+/]{2}[A-Za-z0-9+/]{2})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e)) throw TypeError("invalid encoding");
		}
		return e.decodeUTF8 = function(e) {
			if (typeof e != "string") throw TypeError("expected string");
			var t, n = unescape(encodeURIComponent(e)), r = new Uint8Array(n.length);
			for (t = 0; t < n.length; t++) r[t] = n.charCodeAt(t);
			return r;
		}, e.encodeUTF8 = function(e) {
			var t, n = [];
			for (t = 0; t < e.length; t++) n.push(String.fromCharCode(e[t]));
			return decodeURIComponent(escape(n.join("")));
		}, typeof atob > "u" ? Buffer.from === void 0 ? (e.encodeBase64 = function(e) {
			return new Buffer(e).toString("base64");
		}, e.decodeBase64 = function(e) {
			return t(e), new Uint8Array(Array.prototype.slice.call(new Buffer(e, "base64"), 0));
		}) : (e.encodeBase64 = function(e) {
			return Buffer.from(e).toString("base64");
		}, e.decodeBase64 = function(e) {
			return t(e), new Uint8Array(Array.prototype.slice.call(Buffer.from(e, "base64"), 0));
		}) : (e.encodeBase64 = function(e) {
			var t, n = [], r = e.length;
			for (t = 0; t < r; t++) n.push(String.fromCharCode(e[t]));
			return btoa(n.join(""));
		}, e.decodeBase64 = function(e) {
			t(e);
			var n, r = atob(e), i = new Uint8Array(r.length);
			for (n = 0; n < r.length; n++) i[n] = r.charCodeAt(n);
			return i;
		}), e;
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/@creit.tech+xbull-wallet-connect@0.4.0/node_modules/@creit.tech/xbull-wallet-connect/interfaces.js
function Ls(e) {
	return !!e.error;
}
var Rs, zs = t((() => {
	Rs = ((e) => (e.XBULL_CONNECT = "XBULL_CONNECT", e.XBULL_GET_PUBLIC_KEY = "XBULL_GET_PUBLIC_KEY", e.XBULL_SIGN_XDR = "XBULL_SIGN_XDR", e.XBULL_GET_NETWORK = "XBULL_GET_NETWORK", e.XBULL_SIGN_MESSAGE = "XBULL_SIGN_MESSAGE", e.XBULL_INITIAL_RESPONSE = "XBULL_INITIAL_RESPONSE", e.XBULL_CONNECT_RESPONSE = "XBULL_CONNECT_RESPONSE", e.XBULL_SIGN = "XBULL_SIGN", e.XBULL_SIGN_RESPONSE = "XBULL_SIGN_RESPONSE", e.XBULL_SIGN_MESSAGE_RESPONSE = "XBULL_SIGN_MESSAGE_RESPONSE", e))(Rs || {});
}));
//#endregion
//#region ../../node_modules/.pnpm/tslib@2.8.1/node_modules/tslib/tslib.es6.mjs
function Bs(e, t) {
	if (typeof t != "function" && t !== null) throw TypeError("Class extends value " + String(t) + " is not a constructor or null");
	Ys(e, t);
	function n() {
		this.constructor = e;
	}
	e.prototype = t === null ? Object.create(t) : (n.prototype = t.prototype, new n());
}
function Vs(e, t, n, r) {
	function i(e) {
		return e instanceof n ? e : new n(function(t) {
			t(e);
		});
	}
	return new (n ||= Promise)(function(n, a) {
		function o(e) {
			try {
				c(r.next(e));
			} catch (e) {
				a(e);
			}
		}
		function s(e) {
			try {
				c(r.throw(e));
			} catch (e) {
				a(e);
			}
		}
		function c(e) {
			e.done ? n(e.value) : i(e.value).then(o, s);
		}
		c((r = r.apply(e, t || [])).next());
	});
}
function Hs(e, t) {
	var n = {
		label: 0,
		sent: function() {
			if (a[0] & 1) throw a[1];
			return a[1];
		},
		trys: [],
		ops: []
	}, r, i, a, o = Object.create((typeof Iterator == "function" ? Iterator : Object).prototype);
	return o.next = s(0), o.throw = s(1), o.return = s(2), typeof Symbol == "function" && (o[Symbol.iterator] = function() {
		return this;
	}), o;
	function s(e) {
		return function(t) {
			return c([e, t]);
		};
	}
	function c(s) {
		if (r) throw TypeError("Generator is already executing.");
		for (; o && (o = 0, s[0] && (n = 0)), n;) try {
			if (r = 1, i && (a = s[0] & 2 ? i.return : s[0] ? i.throw || ((a = i.return) && a.call(i), 0) : i.next) && !(a = a.call(i, s[1])).done) return a;
			switch (i = 0, a && (s = [s[0] & 2, a.value]), s[0]) {
				case 0:
				case 1:
					a = s;
					break;
				case 4: return n.label++, {
					value: s[1],
					done: !1
				};
				case 5:
					n.label++, i = s[1], s = [0];
					continue;
				case 7:
					s = n.ops.pop(), n.trys.pop();
					continue;
				default:
					if ((a = n.trys, !(a = a.length > 0 && a[a.length - 1])) && (s[0] === 6 || s[0] === 2)) {
						n = 0;
						continue;
					}
					if (s[0] === 3 && (!a || s[1] > a[0] && s[1] < a[3])) {
						n.label = s[1];
						break;
					}
					if (s[0] === 6 && n.label < a[1]) {
						n.label = a[1], a = s;
						break;
					}
					if (a && n.label < a[2]) {
						n.label = a[2], n.ops.push(s);
						break;
					}
					a[2] && n.ops.pop(), n.trys.pop();
					continue;
			}
			s = t.call(e, n);
		} catch (e) {
			s = [6, e], i = 0;
		} finally {
			r = a = 0;
		}
		if (s[0] & 5) throw s[1];
		return {
			value: s[0] ? s[1] : void 0,
			done: !0
		};
	}
}
function Us(e) {
	var t = typeof Symbol == "function" && Symbol.iterator, n = t && e[t], r = 0;
	if (n) return n.call(e);
	if (e && typeof e.length == "number") return { next: function() {
		return e && r >= e.length && (e = void 0), {
			value: e && e[r++],
			done: !e
		};
	} };
	throw TypeError(t ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function Ws(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}
function Gs(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}
function Ks(e) {
	return this instanceof Ks ? (this.v = e, this) : new Ks(e);
}
function qs(e, t, n) {
	if (!Symbol.asyncIterator) throw TypeError("Symbol.asyncIterator is not defined.");
	var r = n.apply(e, t || []), i, a = [];
	return i = Object.create((typeof AsyncIterator == "function" ? AsyncIterator : Object).prototype), s("next"), s("throw"), s("return", o), i[Symbol.asyncIterator] = function() {
		return this;
	}, i;
	function o(e) {
		return function(t) {
			return Promise.resolve(t).then(e, d);
		};
	}
	function s(e, t) {
		r[e] && (i[e] = function(t) {
			return new Promise(function(n, r) {
				a.push([
					e,
					t,
					n,
					r
				]) > 1 || c(e, t);
			});
		}, t && (i[e] = t(i[e])));
	}
	function c(e, t) {
		try {
			l(r[e](t));
		} catch (e) {
			f(a[0][3], e);
		}
	}
	function l(e) {
		e.value instanceof Ks ? Promise.resolve(e.value.v).then(u, d) : f(a[0][2], e);
	}
	function u(e) {
		c("next", e);
	}
	function d(e) {
		c("throw", e);
	}
	function f(e, t) {
		e(t), a.shift(), a.length && c(a[0][0], a[0][1]);
	}
}
function Js(e) {
	if (!Symbol.asyncIterator) throw TypeError("Symbol.asyncIterator is not defined.");
	var t = e[Symbol.asyncIterator], n;
	return t ? t.call(e) : (e = typeof Us == "function" ? Us(e) : e[Symbol.iterator](), n = {}, r("next"), r("throw"), r("return"), n[Symbol.asyncIterator] = function() {
		return this;
	}, n);
	function r(t) {
		n[t] = e[t] && function(n) {
			return new Promise(function(r, a) {
				n = e[t](n), i(r, a, n.done, n.value);
			});
		};
	}
	function i(e, t, n, r) {
		Promise.resolve(r).then(function(t) {
			e({
				value: t,
				done: n
			});
		}, t);
	}
}
var Ys, Xs = t((() => {
	Ys = function(e, t) {
		return Ys = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, t) {
			e.__proto__ = t;
		} || function(e, t) {
			for (var n in t) Object.prototype.hasOwnProperty.call(t, n) && (e[n] = t[n]);
		}, Ys(e, t);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isFunction.js
function Zs(e) {
	return typeof e == "function";
}
var Qs = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/createErrorClass.js
function $s(e) {
	var t = e(function(e) {
		Error.call(e), e.stack = (/* @__PURE__ */ Error()).stack;
	});
	return t.prototype = Object.create(Error.prototype), t.prototype.constructor = t, t;
}
var ec = t((() => {})), tc, nc = t((() => {
	ec(), tc = $s(function(e) {
		return function(t) {
			e(this), this.message = t ? t.length + " errors occurred during unsubscription:\n" + t.map(function(e, t) {
				return t + 1 + ") " + e.toString();
			}).join("\n  ") : "", this.name = "UnsubscriptionError", this.errors = t;
		};
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/arrRemove.js
function rc(e, t) {
	if (e) {
		var n = e.indexOf(t);
		0 <= n && e.splice(n, 1);
	}
}
var ic = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/Subscription.js
function ac(e) {
	return e instanceof sc || e && "closed" in e && Zs(e.remove) && Zs(e.add) && Zs(e.unsubscribe);
}
function oc(e) {
	Zs(e) ? e() : e.unsubscribe();
}
var sc, cc, lc = t((() => {
	Xs(), Qs(), nc(), ic(), sc = function() {
		function e(e) {
			this.initialTeardown = e, this.closed = !1, this._parentage = null, this._finalizers = null;
		}
		return e.prototype.unsubscribe = function() {
			var e, t, n, r, i;
			if (!this.closed) {
				this.closed = !0;
				var a = this._parentage;
				if (a) if (this._parentage = null, Array.isArray(a)) try {
					for (var o = Us(a), s = o.next(); !s.done; s = o.next()) s.value.remove(this);
				} catch (t) {
					e = { error: t };
				} finally {
					try {
						s && !s.done && (t = o.return) && t.call(o);
					} finally {
						if (e) throw e.error;
					}
				}
				else a.remove(this);
				var c = this.initialTeardown;
				if (Zs(c)) try {
					c();
				} catch (e) {
					i = e instanceof tc ? e.errors : [e];
				}
				var l = this._finalizers;
				if (l) {
					this._finalizers = null;
					try {
						for (var u = Us(l), d = u.next(); !d.done; d = u.next()) {
							var f = d.value;
							try {
								oc(f);
							} catch (e) {
								i ??= [], e instanceof tc ? i = Gs(Gs([], Ws(i)), Ws(e.errors)) : i.push(e);
							}
						}
					} catch (e) {
						n = { error: e };
					} finally {
						try {
							d && !d.done && (r = u.return) && r.call(u);
						} finally {
							if (n) throw n.error;
						}
					}
				}
				if (i) throw new tc(i);
			}
		}, e.prototype.add = function(t) {
			if (t && t !== this) if (this.closed) oc(t);
			else {
				if (t instanceof e) {
					if (t.closed || t._hasParent(this)) return;
					t._addParent(this);
				}
				(this._finalizers = this._finalizers ?? []).push(t);
			}
		}, e.prototype._hasParent = function(e) {
			var t = this._parentage;
			return t === e || Array.isArray(t) && t.includes(e);
		}, e.prototype._addParent = function(e) {
			var t = this._parentage;
			this._parentage = Array.isArray(t) ? (t.push(e), t) : t ? [t, e] : e;
		}, e.prototype._removeParent = function(e) {
			var t = this._parentage;
			t === e ? this._parentage = null : Array.isArray(t) && rc(t, e);
		}, e.prototype.remove = function(t) {
			var n = this._finalizers;
			n && rc(n, t), t instanceof e && t._removeParent(this);
		}, e.EMPTY = (function() {
			var t = new e();
			return t.closed = !0, t;
		})(), e;
	}(), cc = sc.EMPTY;
})), uc, dc = t((() => {
	uc = {
		onUnhandledError: null,
		onStoppedNotification: null,
		Promise: void 0,
		useDeprecatedSynchronousErrorHandling: !1,
		useDeprecatedNextContext: !1
	};
})), fc, pc = t((() => {
	Xs(), fc = {
		setTimeout: function(e, t) {
			var n = [...arguments].slice(2), r = fc.delegate;
			return r?.setTimeout ? r.setTimeout.apply(r, Gs([e, t], Ws(n))) : setTimeout.apply(void 0, Gs([e, t], Ws(n)));
		},
		clearTimeout: function(e) {
			return (fc.delegate?.clearTimeout || clearTimeout)(e);
		},
		delegate: void 0
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/reportUnhandledError.js
function mc(e) {
	fc.setTimeout(function() {
		var t = uc.onUnhandledError;
		if (t) t(e);
		else throw e;
	});
}
var hc = t((() => {
	dc(), pc();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/noop.js
function gc() {}
var _c = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/NotificationFactories.js
function vc(e) {
	return bc("E", void 0, e);
}
function yc(e) {
	return bc("N", e, void 0);
}
function bc(e, t, n) {
	return {
		kind: e,
		value: t,
		error: n
	};
}
var xc, Sc = t((() => {
	xc = (function() {
		return bc("C", void 0, void 0);
	})();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/errorContext.js
function Cc(e) {
	if (uc.useDeprecatedSynchronousErrorHandling) {
		var t = !Tc;
		if (t && (Tc = {
			errorThrown: !1,
			error: null
		}), e(), t) {
			var n = Tc, r = n.errorThrown, i = n.error;
			if (Tc = null, r) throw i;
		}
	} else e();
}
function wc(e) {
	uc.useDeprecatedSynchronousErrorHandling && Tc && (Tc.errorThrown = !0, Tc.error = e);
}
var Tc, Ec = t((() => {
	dc(), Tc = null;
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/Subscriber.js
function Dc(e, t) {
	return Mc.call(e, t);
}
function Oc(e) {
	uc.useDeprecatedSynchronousErrorHandling ? wc(e) : mc(e);
}
function kc(e) {
	throw e;
}
function Ac(e, t) {
	var n = uc.onStoppedNotification;
	n && fc.setTimeout(function() {
		return n(e, t);
	});
}
var jc, Mc, Nc, Pc, Fc, Ic = t((() => {
	Xs(), Qs(), lc(), dc(), hc(), _c(), Sc(), pc(), Ec(), jc = function(e) {
		Bs(t, e);
		function t(t) {
			var n = e.call(this) || this;
			return n.isStopped = !1, t ? (n.destination = t, ac(t) && t.add(n)) : n.destination = Fc, n;
		}
		return t.create = function(e, t, n) {
			return new Pc(e, t, n);
		}, t.prototype.next = function(e) {
			this.isStopped ? Ac(yc(e), this) : this._next(e);
		}, t.prototype.error = function(e) {
			this.isStopped ? Ac(vc(e), this) : (this.isStopped = !0, this._error(e));
		}, t.prototype.complete = function() {
			this.isStopped ? Ac(xc, this) : (this.isStopped = !0, this._complete());
		}, t.prototype.unsubscribe = function() {
			this.closed || (this.isStopped = !0, e.prototype.unsubscribe.call(this), this.destination = null);
		}, t.prototype._next = function(e) {
			this.destination.next(e);
		}, t.prototype._error = function(e) {
			try {
				this.destination.error(e);
			} finally {
				this.unsubscribe();
			}
		}, t.prototype._complete = function() {
			try {
				this.destination.complete();
			} finally {
				this.unsubscribe();
			}
		}, t;
	}(sc), Mc = Function.prototype.bind, Nc = function() {
		function e(e) {
			this.partialObserver = e;
		}
		return e.prototype.next = function(e) {
			var t = this.partialObserver;
			if (t.next) try {
				t.next(e);
			} catch (e) {
				Oc(e);
			}
		}, e.prototype.error = function(e) {
			var t = this.partialObserver;
			if (t.error) try {
				t.error(e);
			} catch (e) {
				Oc(e);
			}
			else Oc(e);
		}, e.prototype.complete = function() {
			var e = this.partialObserver;
			if (e.complete) try {
				e.complete();
			} catch (e) {
				Oc(e);
			}
		}, e;
	}(), Pc = function(e) {
		Bs(t, e);
		function t(t, n, r) {
			var i = e.call(this) || this, a;
			if (Zs(t) || !t) a = {
				next: t ?? void 0,
				error: n ?? void 0,
				complete: r ?? void 0
			};
			else {
				var o;
				i && uc.useDeprecatedNextContext ? (o = Object.create(t), o.unsubscribe = function() {
					return i.unsubscribe();
				}, a = {
					next: t.next && Dc(t.next, o),
					error: t.error && Dc(t.error, o),
					complete: t.complete && Dc(t.complete, o)
				}) : a = t;
			}
			return i.destination = new Nc(a), i;
		}
		return t;
	}(jc), Fc = {
		closed: !0,
		next: gc,
		error: kc,
		complete: gc
	};
})), Lc, Rc = t((() => {
	Lc = (function() {
		return typeof Symbol == "function" && Symbol.observable || "@@observable";
	})();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/identity.js
function zc(e) {
	return e;
}
var Bc = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/pipe.js
function Vc(e) {
	return e.length === 0 ? zc : e.length === 1 ? e[0] : function(t) {
		return e.reduce(function(e, t) {
			return t(e);
		}, t);
	};
}
var Hc = t((() => {
	Bc();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/Observable.js
function Uc(e) {
	return e ?? uc.Promise ?? Promise;
}
function Wc(e) {
	return e && Zs(e.next) && Zs(e.error) && Zs(e.complete);
}
function Gc(e) {
	return e && e instanceof jc || Wc(e) && ac(e);
}
var Kc, qc = t((() => {
	Ic(), lc(), Rc(), Hc(), dc(), Qs(), Ec(), Kc = function() {
		function e(e) {
			e && (this._subscribe = e);
		}
		return e.prototype.lift = function(t) {
			var n = new e();
			return n.source = this, n.operator = t, n;
		}, e.prototype.subscribe = function(e, t, n) {
			var r = this, i = Gc(e) ? e : new Pc(e, t, n);
			return Cc(function() {
				var e = r, t = e.operator, n = e.source;
				i.add(t ? t.call(i, n) : n ? r._subscribe(i) : r._trySubscribe(i));
			}), i;
		}, e.prototype._trySubscribe = function(e) {
			try {
				return this._subscribe(e);
			} catch (t) {
				e.error(t);
			}
		}, e.prototype.forEach = function(e, t) {
			var n = this;
			return t = Uc(t), new t(function(t, r) {
				var i = new Pc({
					next: function(t) {
						try {
							e(t);
						} catch (e) {
							r(e), i.unsubscribe();
						}
					},
					error: r,
					complete: t
				});
				n.subscribe(i);
			});
		}, e.prototype._subscribe = function(e) {
			return this.source?.subscribe(e);
		}, e.prototype[Lc] = function() {
			return this;
		}, e.prototype.pipe = function() {
			return Vc([...arguments])(this);
		}, e.prototype.toPromise = function(e) {
			var t = this;
			return e = Uc(e), new e(function(e, n) {
				var r;
				t.subscribe(function(e) {
					return r = e;
				}, function(e) {
					return n(e);
				}, function() {
					return e(r);
				});
			});
		}, e.create = function(t) {
			return new e(t);
		}, e;
	}();
})), Jc, Yc = t((() => {
	ec(), Jc = $s(function(e) {
		return function() {
			e(this), this.name = "ObjectUnsubscribedError", this.message = "object unsubscribed";
		};
	});
})), Xc, Zc, Qc = t((() => {
	Xs(), qc(), lc(), Yc(), ic(), Ec(), Xc = function(e) {
		Bs(t, e);
		function t() {
			var t = e.call(this) || this;
			return t.closed = !1, t.currentObservers = null, t.observers = [], t.isStopped = !1, t.hasError = !1, t.thrownError = null, t;
		}
		return t.prototype.lift = function(e) {
			var t = new Zc(this, this);
			return t.operator = e, t;
		}, t.prototype._throwIfClosed = function() {
			if (this.closed) throw new Jc();
		}, t.prototype.next = function(e) {
			var t = this;
			Cc(function() {
				var n, r;
				if (t._throwIfClosed(), !t.isStopped) {
					t.currentObservers ||= Array.from(t.observers);
					try {
						for (var i = Us(t.currentObservers), a = i.next(); !a.done; a = i.next()) a.value.next(e);
					} catch (e) {
						n = { error: e };
					} finally {
						try {
							a && !a.done && (r = i.return) && r.call(i);
						} finally {
							if (n) throw n.error;
						}
					}
				}
			});
		}, t.prototype.error = function(e) {
			var t = this;
			Cc(function() {
				if (t._throwIfClosed(), !t.isStopped) {
					t.hasError = t.isStopped = !0, t.thrownError = e;
					for (var n = t.observers; n.length;) n.shift().error(e);
				}
			});
		}, t.prototype.complete = function() {
			var e = this;
			Cc(function() {
				if (e._throwIfClosed(), !e.isStopped) {
					e.isStopped = !0;
					for (var t = e.observers; t.length;) t.shift().complete();
				}
			});
		}, t.prototype.unsubscribe = function() {
			this.isStopped = this.closed = !0, this.observers = this.currentObservers = null;
		}, Object.defineProperty(t.prototype, "observed", {
			get: function() {
				return this.observers?.length > 0;
			},
			enumerable: !1,
			configurable: !0
		}), t.prototype._trySubscribe = function(t) {
			return this._throwIfClosed(), e.prototype._trySubscribe.call(this, t);
		}, t.prototype._subscribe = function(e) {
			return this._throwIfClosed(), this._checkFinalizedStatuses(e), this._innerSubscribe(e);
		}, t.prototype._innerSubscribe = function(e) {
			var t = this, n = this, r = n.hasError, i = n.isStopped, a = n.observers;
			return r || i ? cc : (this.currentObservers = null, a.push(e), new sc(function() {
				t.currentObservers = null, rc(a, e);
			}));
		}, t.prototype._checkFinalizedStatuses = function(e) {
			var t = this, n = t.hasError, r = t.thrownError, i = t.isStopped;
			n ? e.error(r) : i && e.complete();
		}, t.prototype.asObservable = function() {
			var e = new Kc();
			return e.source = this, e;
		}, t.create = function(e, t) {
			return new Zc(e, t);
		}, t;
	}(Kc), Zc = function(e) {
		Bs(t, e);
		function t(t, n) {
			var r = e.call(this) || this;
			return r.destination = t, r.source = n, r;
		}
		return t.prototype.next = function(e) {
			var t, n;
			(n = (t = this.destination)?.next) == null || n.call(t, e);
		}, t.prototype.error = function(e) {
			var t, n;
			(n = (t = this.destination)?.error) == null || n.call(t, e);
		}, t.prototype.complete = function() {
			var e, t;
			(t = (e = this.destination)?.complete) == null || t.call(e);
		}, t.prototype._subscribe = function(e) {
			return this.source?.subscribe(e) ?? cc;
		}, t;
	}(Xc);
})), $c, el = t((() => {
	ec(), $c = $s(function(e) {
		return function() {
			e(this), this.name = "EmptyError", this.message = "no elements in sequence";
		};
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/firstValueFrom.js
function tl(e, t) {
	var n = typeof t == "object";
	return new Promise(function(r, i) {
		var a = new Pc({
			next: function(e) {
				r(e), a.unsubscribe();
			},
			error: i,
			complete: function() {
				n ? r(t.defaultValue) : i(new $c());
			}
		});
		e.subscribe(a);
	});
}
var nl = t((() => {
	el(), Ic();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isScheduler.js
function rl(e) {
	return e && Zs(e.schedule);
}
var il = t((() => {
	Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/args.js
function al(e) {
	return e[e.length - 1];
}
function ol(e) {
	return rl(al(e)) ? e.pop() : void 0;
}
var sl = t((() => {
	il();
})), cl, ll = t((() => {
	cl = (function(e) {
		return e && typeof e.length == "number" && typeof e != "function";
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isPromise.js
function ul(e) {
	return Zs(e?.then);
}
var dl = t((() => {
	Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isInteropObservable.js
function fl(e) {
	return Zs(e[Lc]);
}
var pl = t((() => {
	Rc(), Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isAsyncIterable.js
function ml(e) {
	return Symbol.asyncIterator && Zs(e?.[Symbol.asyncIterator]);
}
var hl = t((() => {
	Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/throwUnobservableError.js
function gl(e) {
	return /* @__PURE__ */ TypeError("You provided " + (typeof e == "object" && e ? "an invalid object" : "'" + e + "'") + " where a stream was expected. You can provide an Observable, Promise, ReadableStream, Array, AsyncIterable, or Iterable.");
}
var _l = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/symbol/iterator.js
function vl() {
	return typeof Symbol != "function" || !Symbol.iterator ? "@@iterator" : Symbol.iterator;
}
var yl, bl = t((() => {
	yl = vl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isIterable.js
function xl(e) {
	return Zs(e?.[yl]);
}
var Sl = t((() => {
	bl(), Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isReadableStreamLike.js
function Cl(e) {
	return qs(this, arguments, function() {
		var t, n, r, i;
		return Hs(this, function(a) {
			switch (a.label) {
				case 0: t = e.getReader(), a.label = 1;
				case 1: a.trys.push([
					1,
					,
					9,
					10
				]), a.label = 2;
				case 2: return [4, Ks(t.read())];
				case 3: return n = a.sent(), r = n.value, i = n.done, i ? [4, Ks(void 0)] : [3, 5];
				case 4: return [2, a.sent()];
				case 5: return [4, Ks(r)];
				case 6: return [4, a.sent()];
				case 7: return a.sent(), [3, 2];
				case 8: return [3, 10];
				case 9: return t.releaseLock(), [7];
				case 10: return [2];
			}
		});
	});
}
function wl(e) {
	return Zs(e?.getReader);
}
var Tl = t((() => {
	Xs(), Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/observable/innerFrom.js
function El(e) {
	if (e instanceof Kc) return e;
	if (e != null) {
		if (fl(e)) return Dl(e);
		if (cl(e)) return Ol(e);
		if (ul(e)) return kl(e);
		if (ml(e)) return jl(e);
		if (xl(e)) return Al(e);
		if (wl(e)) return Ml(e);
	}
	throw gl(e);
}
function Dl(e) {
	return new Kc(function(t) {
		var n = e[Lc]();
		if (Zs(n.subscribe)) return n.subscribe(t);
		throw TypeError("Provided object does not correctly implement Symbol.observable");
	});
}
function Ol(e) {
	return new Kc(function(t) {
		for (var n = 0; n < e.length && !t.closed; n++) t.next(e[n]);
		t.complete();
	});
}
function kl(e) {
	return new Kc(function(t) {
		e.then(function(e) {
			t.closed || (t.next(e), t.complete());
		}, function(e) {
			return t.error(e);
		}).then(null, mc);
	});
}
function Al(e) {
	return new Kc(function(t) {
		var n, r;
		try {
			for (var i = Us(e), a = i.next(); !a.done; a = i.next()) {
				var o = a.value;
				if (t.next(o), t.closed) return;
			}
		} catch (e) {
			n = { error: e };
		} finally {
			try {
				a && !a.done && (r = i.return) && r.call(i);
			} finally {
				if (n) throw n.error;
			}
		}
		t.complete();
	});
}
function jl(e) {
	return new Kc(function(t) {
		Nl(e, t).catch(function(e) {
			return t.error(e);
		});
	});
}
function Ml(e) {
	return jl(Cl(e));
}
function Nl(e, t) {
	var n, r, i, a;
	return Vs(this, void 0, void 0, function() {
		var o, s;
		return Hs(this, function(c) {
			switch (c.label) {
				case 0: c.trys.push([
					0,
					5,
					6,
					11
				]), n = Js(e), c.label = 1;
				case 1: return [4, n.next()];
				case 2:
					if (r = c.sent(), r.done) return [3, 4];
					if (o = r.value, t.next(o), t.closed) return [2];
					c.label = 3;
				case 3: return [3, 1];
				case 4: return [3, 11];
				case 5: return s = c.sent(), i = { error: s }, [3, 11];
				case 6: return c.trys.push([
					6,
					,
					9,
					10
				]), r && !r.done && (a = n.return) ? [4, a.call(n)] : [3, 8];
				case 7: c.sent(), c.label = 8;
				case 8: return [3, 10];
				case 9:
					if (i) throw i.error;
					return [7];
				case 10: return [7];
				case 11: return t.complete(), [2];
			}
		});
	});
}
var Pl = t((() => {
	Xs(), ll(), dl(), qc(), pl(), hl(), _l(), Sl(), Tl(), Qs(), hc(), Rc();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/executeSchedule.js
function Fl(e, t, n, r, i) {
	r === void 0 && (r = 0), i === void 0 && (i = !1);
	var a = t.schedule(function() {
		n(), i ? e.add(this.schedule(null, r)) : this.unsubscribe();
	}, r);
	if (e.add(a), !i) return a;
}
var Il = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/lift.js
function Ll(e) {
	return Zs(e?.lift);
}
function Rl(e) {
	return function(t) {
		if (Ll(t)) return t.lift(function(t) {
			try {
				return e(t, this);
			} catch (e) {
				this.error(e);
			}
		});
		throw TypeError("Unable to lift unknown Observable type");
	};
}
var zl = t((() => {
	Qs();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/OperatorSubscriber.js
function Bl(e, t, n, r, i) {
	return new Vl(e, t, n, r, i);
}
var Vl, Hl = t((() => {
	Xs(), Ic(), Vl = function(e) {
		Bs(t, e);
		function t(t, n, r, i, a, o) {
			var s = e.call(this, t) || this;
			return s.onFinalize = a, s.shouldUnsubscribe = o, s._next = n ? function(e) {
				try {
					n(e);
				} catch (e) {
					t.error(e);
				}
			} : e.prototype._next, s._error = i ? function(e) {
				try {
					i(e);
				} catch (e) {
					t.error(e);
				} finally {
					this.unsubscribe();
				}
			} : e.prototype._error, s._complete = r ? function() {
				try {
					r();
				} catch (e) {
					t.error(e);
				} finally {
					this.unsubscribe();
				}
			} : e.prototype._complete, s;
		}
		return t.prototype.unsubscribe = function() {
			var t;
			if (!this.shouldUnsubscribe || this.shouldUnsubscribe()) {
				var n = this.closed;
				e.prototype.unsubscribe.call(this), !n && ((t = this.onFinalize) == null || t.call(this));
			}
		}, t;
	}(jc);
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/observeOn.js
function Ul(e, t) {
	return t === void 0 && (t = 0), Rl(function(n, r) {
		n.subscribe(Bl(r, function(n) {
			return Fl(r, e, function() {
				return r.next(n);
			}, t);
		}, function() {
			return Fl(r, e, function() {
				return r.complete();
			}, t);
		}, function(n) {
			return Fl(r, e, function() {
				return r.error(n);
			}, t);
		}));
	});
}
var Wl = t((() => {
	Il(), zl(), Hl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/subscribeOn.js
function Gl(e, t) {
	return t === void 0 && (t = 0), Rl(function(n, r) {
		r.add(e.schedule(function() {
			return n.subscribe(r);
		}, t));
	});
}
var Kl = t((() => {
	zl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduleObservable.js
function ql(e, t) {
	return El(e).pipe(Gl(t), Ul(t));
}
var Jl = t((() => {
	Pl(), Wl(), Kl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/schedulePromise.js
function Yl(e, t) {
	return El(e).pipe(Gl(t), Ul(t));
}
var Xl = t((() => {
	Pl(), Wl(), Kl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduleArray.js
function Zl(e, t) {
	return new Kc(function(n) {
		var r = 0;
		return t.schedule(function() {
			r === e.length ? n.complete() : (n.next(e[r++]), n.closed || this.schedule());
		});
	});
}
var Ql = t((() => {
	qc();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduleIterable.js
function $l(e, t) {
	return new Kc(function(n) {
		var r;
		return Fl(n, t, function() {
			r = e[yl](), Fl(n, t, function() {
				var e, t, i;
				try {
					e = r.next(), t = e.value, i = e.done;
				} catch (e) {
					n.error(e);
					return;
				}
				i ? n.complete() : n.next(t);
			}, 0, !0);
		}), function() {
			return Zs(r?.return) && r.return();
		};
	});
}
var eu = t((() => {
	qc(), bl(), Qs(), Il();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduleAsyncIterable.js
function tu(e, t) {
	if (!e) throw Error("Iterable cannot be null");
	return new Kc(function(n) {
		Fl(n, t, function() {
			var r = e[Symbol.asyncIterator]();
			Fl(n, t, function() {
				r.next().then(function(e) {
					e.done ? n.complete() : n.next(e.value);
				});
			}, 0, !0);
		});
	});
}
var nu = t((() => {
	qc(), Il();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduleReadableStreamLike.js
function ru(e, t) {
	return tu(Cl(e), t);
}
var iu = t((() => {
	nu(), Tl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/scheduled/scheduled.js
function au(e, t) {
	if (e != null) {
		if (fl(e)) return ql(e, t);
		if (cl(e)) return Zl(e, t);
		if (ul(e)) return Yl(e, t);
		if (ml(e)) return tu(e, t);
		if (xl(e)) return $l(e, t);
		if (wl(e)) return ru(e, t);
	}
	throw gl(e);
}
var ou = t((() => {
	Jl(), Xl(), Ql(), eu(), nu(), pl(), dl(), ll(), Sl(), hl(), _l(), Tl(), iu();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/observable/from.js
function su(e, t) {
	return t ? au(e, t) : El(e);
}
var cu = t((() => {
	ou(), Pl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/observable/of.js
function lu() {
	var e = [...arguments];
	return su(e, ol(e));
}
var uu = t((() => {
	sl(), cu();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/observable/throwError.js
function du(e, t) {
	var n = Zs(e) ? e : function() {
		return e;
	}, r = function(e) {
		return e.error(n());
	};
	return new Kc(t ? function(e) {
		return t.schedule(r, 0, e);
	} : r);
}
var fu = t((() => {
	qc(), Qs();
})), pu, mu = t((() => {
	Xs(), lc(), pu = function(e) {
		Bs(t, e);
		function t(t, n) {
			return e.call(this) || this;
		}
		return t.prototype.schedule = function(e, t) {
			return t === void 0 && (t = 0), this;
		}, t;
	}(sc);
})), hu, gu = t((() => {
	Xs(), hu = {
		setInterval: function(e, t) {
			var n = [...arguments].slice(2), r = hu.delegate;
			return r?.setInterval ? r.setInterval.apply(r, Gs([e, t], Ws(n))) : setInterval.apply(void 0, Gs([e, t], Ws(n)));
		},
		clearInterval: function(e) {
			return (hu.delegate?.clearInterval || clearInterval)(e);
		},
		delegate: void 0
	};
})), _u, vu = t((() => {
	Xs(), mu(), gu(), ic(), _u = function(e) {
		Bs(t, e);
		function t(t, n) {
			var r = e.call(this, t, n) || this;
			return r.scheduler = t, r.work = n, r.pending = !1, r;
		}
		return t.prototype.schedule = function(e, t) {
			if (t === void 0 && (t = 0), this.closed) return this;
			this.state = e;
			var n = this.id, r = this.scheduler;
			return n != null && (this.id = this.recycleAsyncId(r, n, t)), this.pending = !0, this.delay = t, this.id = this.id ?? this.requestAsyncId(r, this.id, t), this;
		}, t.prototype.requestAsyncId = function(e, t, n) {
			return n === void 0 && (n = 0), hu.setInterval(e.flush.bind(e, this), n);
		}, t.prototype.recycleAsyncId = function(e, t, n) {
			if (n === void 0 && (n = 0), n != null && this.delay === n && this.pending === !1) return t;
			t != null && hu.clearInterval(t);
		}, t.prototype.execute = function(e, t) {
			if (this.closed) return /* @__PURE__ */ Error("executing a cancelled action");
			this.pending = !1;
			var n = this._execute(e, t);
			if (n) return n;
			this.pending === !1 && this.id != null && (this.id = this.recycleAsyncId(this.scheduler, this.id, null));
		}, t.prototype._execute = function(e, t) {
			var n = !1, r;
			try {
				this.work(e);
			} catch (e) {
				n = !0, r = e || /* @__PURE__ */ Error("Scheduled action threw falsy error");
			}
			if (n) return this.unsubscribe(), r;
		}, t.prototype.unsubscribe = function() {
			if (!this.closed) {
				var t = this, n = t.id, r = t.scheduler, i = r.actions;
				this.work = this.state = this.scheduler = null, this.pending = !1, rc(i, this), n != null && (this.id = this.recycleAsyncId(r, n, null)), this.delay = null, e.prototype.unsubscribe.call(this);
			}
		}, t;
	}(pu);
})), yu, bu = t((() => {
	yu = {
		now: function() {
			return (yu.delegate || Date).now();
		},
		delegate: void 0
	};
})), xu, Su = t((() => {
	bu(), xu = function() {
		function e(t, n) {
			n === void 0 && (n = e.now), this.schedulerActionCtor = t, this.now = n;
		}
		return e.prototype.schedule = function(e, t, n) {
			return t === void 0 && (t = 0), new this.schedulerActionCtor(this, e).schedule(n, t);
		}, e.now = yu.now, e;
	}();
})), Cu, wu = t((() => {
	Xs(), Su(), Cu = function(e) {
		Bs(t, e);
		function t(t, n) {
			n === void 0 && (n = xu.now);
			var r = e.call(this, t, n) || this;
			return r.actions = [], r._active = !1, r;
		}
		return t.prototype.flush = function(e) {
			var t = this.actions;
			if (this._active) {
				t.push(e);
				return;
			}
			var n;
			this._active = !0;
			do
				if (n = e.execute(e.state, e.delay)) break;
			while (e = t.shift());
			if (this._active = !1, n) {
				for (; e = t.shift();) e.unsubscribe();
				throw n;
			}
		}, t;
	}(xu);
})), Tu, Eu, Du = t((() => {
	vu(), wu(), Tu = new Cu(_u), Eu = Tu;
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/util/isDate.js
function Ou(e) {
	return e instanceof Date && !isNaN(e);
}
var ku = t((() => {}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/observable/timer.js
function Au(e, t, n) {
	e === void 0 && (e = 0), n === void 0 && (n = Eu);
	var r = -1;
	return t != null && (rl(t) ? n = t : r = t), new Kc(function(t) {
		var i = Ou(e) ? +e - n.now() : e;
		i < 0 && (i = 0);
		var a = 0;
		return n.schedule(function() {
			t.closed || (t.next(a++), 0 <= r ? this.schedule(void 0, r) : t.complete());
		}, i);
	});
}
var ju = t((() => {
	qc(), Du(), il(), ku();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/switchMap.js
function Mu(e, t) {
	return Rl(function(n, r) {
		var i = null, a = 0, o = !1, s = function() {
			return o && !i && r.complete();
		};
		n.subscribe(Bl(r, function(n) {
			i?.unsubscribe();
			var o = 0, c = a++;
			El(e(n, c)).subscribe(i = Bl(r, function(e) {
				return r.next(t ? t(n, e, c, o++) : e);
			}, function() {
				i = null, s();
			}));
		}, function() {
			o = !0, s();
		}));
	});
}
var Nu = t((() => {
	Pl(), zl(), Hl();
})), Pu, Fu = t((() => {
	qc(), Pu = new Kc(function(e) {
		return e.complete();
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/take.js
function Iu(e) {
	return e <= 0 ? function() {
		return Pu;
	} : Rl(function(t, n) {
		var r = 0;
		t.subscribe(Bl(n, function(t) {
			++r <= e && (n.next(t), e <= r && n.complete());
		}));
	});
}
var Lu = t((() => {
	Fu(), zl(), Hl();
}));
//#endregion
//#region ../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm5/internal/operators/takeUntil.js
function Ru(e) {
	return Rl(function(t, n) {
		El(e).subscribe(Bl(n, function() {
			return n.complete();
		}, gc)), !n.closed && t.subscribe(n);
	});
}
var zu = t((() => {
	zl(), Hl(), Pl(), _c();
})), Bu = t((() => {
	Qc(), nl(), uu(), fu(), ju(), Nu(), Lu(), zu();
})), Vu, Hu = t((() => {
	zs(), Vu = class {
		constructor() {
			this.isConnected = !1;
		}
		sendEventToContentScript(e, t, n) {
			return new Promise(((r) => {
				let i = (e) => {
					e.source !== window || !e.data || e.origin !== window.origin || e.data.eventId === n && (r(e), window.removeEventListener("message", i, !1));
				};
				window.addEventListener("message", i, !1), window.webkit.messageHandlers.cordova_iab.postMessage(JSON.stringify({
					type: e,
					eventId: n,
					detail: t
				}));
			}));
		}
		async enableConnection() {
			let e = {
				origin: window.origin,
				host: window.location.host,
				permissions: {
					canRequestPublicKey: !0,
					canRequestSign: !0
				}
			}, { detail: t } = (await this.sendEventToContentScript(Rs.XBULL_CONNECT, e, crypto.randomUUID())).data;
			if (!t || t.error) throw {
				code: t?.code || -1,
				message: t?.errorMessage || "Unexpected error"
			};
			this.isConnected = !0;
		}
		async getAddress() {
			try {
				await this.enableConnection();
			} catch (e) {
				return { error: {
					code: e?.code || -1,
					message: e?.message || "Unexpected error"
				} };
			}
			let e = {
				origin: window.origin,
				host: window.location.host
			}, { detail: t } = (await this.sendEventToContentScript(Rs.XBULL_GET_PUBLIC_KEY, e, crypto.randomUUID())).data;
			return !t || t.error ? { error: {
				code: t?.code || -1,
				message: t?.errorMessage || "Unexpected error"
			} } : { address: t.payload };
		}
		async signTransaction(e) {
			if (e.opts?.submit || e.opts?.submitUrl) return { error: {
				code: -1,
				message: "Parameters `submit` and `submitUrl` are not supported"
			} };
			try {
				await this.enableConnection();
			} catch (e) {
				return { error: {
					code: e?.code || -1,
					message: e?.message || "Unexpected error"
				} };
			}
			let t = {
				origin: window.origin,
				host: window.location.host,
				network: e.opts?.networkPassphrase,
				publicKey: e.opts?.address,
				xdr: e.xdr,
				xdrType: "Transaction"
			}, { detail: n } = (await this.sendEventToContentScript(Rs.XBULL_SIGN_XDR, t, crypto.randomUUID())).data;
			return !n || n.error ? { error: {
				code: n?.code || -1,
				message: n?.errorMessage || "Unexpected error"
			} } : {
				signedTxXdr: n.payload.signedXdr,
				signerAddress: n.payload.signerAddress
			};
		}
		async signMessage(e, t) {
			if (!e) return { error: {
				code: -1,
				message: "The message must be defined."
			} };
			try {
				await this.enableConnection();
			} catch (e) {
				return { error: {
					code: e?.code || -1,
					message: e?.message || "Unexpected error"
				} };
			}
			let n = {
				origin: window.origin,
				host: window.location.host,
				message: e,
				publicKey: t?.address,
				network: t?.networkPassphrase
			}, { detail: r } = (await this.sendEventToContentScript(Rs.XBULL_SIGN_MESSAGE, n, crypto.randomUUID())).data;
			return !r || r.error ? { error: {
				code: r?.code || -1,
				message: r?.errorMessage || "Unexpected error"
			} } : {
				signedMessage: r.payload.signedMessage,
				signerAddress: r.payload.signerAddress
			};
		}
		async getNetwork() {
			try {
				await this.enableConnection();
			} catch (e) {
				return { error: {
					code: e?.code || -1,
					message: e?.message || "Unexpected error"
				} };
			}
			let e = {
				origin: window.origin,
				host: window.location.host
			}, { detail: t } = (await this.sendEventToContentScript(Rs.XBULL_GET_NETWORK, e, crypto.randomUUID())).data;
			return !t || t.error ? { error: {
				code: t?.code || -1,
				message: t?.errorMessage || "Unexpected error"
			} } : {
				network: t.payload.network,
				networkPassphrase: t.payload.networkPassphrase
			};
		}
	};
})), Uu, Wu, Gu, Ku = t((() => {
	Uu = Fs(), Wu = Is(), zs(), Bu(), Hu(), Gu = class {
		constructor(e) {
			this.closeCurrentPromises$ = new Xc(), this.closeObservables$ = new Xc(), this.initialResponse$ = new Xc(), this.initialResponseCompleted$ = new Xc(), this.connectResponse$ = new Xc(), this.connectResult$ = new Xc(), this.signResponse$ = new Xc(), this.signResult$ = new Xc(), this.signMessageResponse$ = new Xc(), this.signMessageResult$ = new Xc(), this.closeCurrentPromisesSubscription = Au(1e3, 1e3).pipe(Ru(this.closeObservables$)).subscribe((() => {
				this.target?.closed && this.closeCurrentPromises$.next();
			})), this.onInititalResponseSubscription = this.initialResponse$.pipe(Ru(this.closeObservables$)).subscribe(((e) => {
				let t = this.decryptFromReceiver({
					oneTimeCode: e.data.oneTimeCode,
					payload: e.data.message,
					senderPublicKey: e.data.publicKey
				});
				JSON.parse(t).providedSession === this.session() && (this.targetPublicKey = e.data.publicKey, this.initialResponseCompleted$.next());
			})), this.onConnectResponseSubscription = this.connectResponse$.pipe(Ru(this.closeObservables$)).subscribe(((e) => {
				if (!this.targetPublicKey) return void this.connectResult$.next({
					success: !1,
					message: "Wallet encryption public key is not provided, request rejected."
				});
				if (!e.data.success) return void this.connectResult$.next({
					success: !1,
					message: "Request rejected from the wallet"
				});
				let t = this.decryptFromReceiver({
					oneTimeCode: e.data.oneTimeCode,
					payload: e.data.message,
					senderPublicKey: this.targetPublicKey
				}), n = JSON.parse(t);
				this.connectResult$.next({
					success: !0,
					publicKey: n.publicKey
				});
			})), this.onSignResponseSubscription = this.signResponse$.pipe(Ru(this.closeObservables$)).subscribe(((e) => {
				if (!this.targetPublicKey) return void this.signResult$.next({
					success: !1,
					message: "Wallet encryption public key is not provided, request rejected."
				});
				if (!e.data.success) return void this.signResult$.next({
					success: !1,
					message: "Request rejected from the wallet"
				});
				let t = this.decryptFromReceiver({
					oneTimeCode: e.data.oneTimeCode,
					payload: e.data.message,
					senderPublicKey: this.targetPublicKey
				}), n = JSON.parse(t);
				this.signResult$.next({
					success: !0,
					xdr: n.xdr
				});
			})), this.onSignMessageResponseSubscription = this.signMessageResponse$.pipe(Ru(this.closeObservables$)).subscribe(((e) => {
				if (!this.targetPublicKey) return void this.signMessageResult$.next({
					success: !1,
					message: "Wallet encryption public key is not provided, request rejected."
				});
				if (!e.data.success) return void this.signMessageResult$.next({
					success: !1,
					message: "Request rejected from the wallet"
				});
				let t = this.decryptFromReceiver({
					oneTimeCode: e.data.oneTimeCode,
					payload: e.data.message,
					senderPublicKey: this.targetPublicKey
				}), n = JSON.parse(t);
				this.signMessageResult$.next({
					success: !0,
					...n
				});
			})), this.preferredTarget = e?.preferredTarget || "extension", this.walletUrl = e?.url || "https://wallet.xbull.app/connect";
			let t = Uu.box.keyPair(), n = (0, Wu.encodeBase64)((0, Uu.randomBytes)(24));
			this.encryptForReceiver = (e) => {
				let n = (0, Uu.randomBytes)(24);
				return {
					message: (0, Wu.encodeBase64)((0, Uu.box)((0, Wu.decodeUTF8)(e.data), n, e.receiverPublicKey, t.secretKey)),
					oneTimeCode: (0, Wu.encodeBase64)(n)
				};
			}, this.decryptFromReceiver = (e) => {
				let n = Uu.box.open((0, Wu.decodeBase64)(e.payload), (0, Wu.decodeBase64)(e.oneTimeCode), (0, Wu.decodeBase64)(e.senderPublicKey), t.secretKey);
				if (!n) throw Error("Decrypted message is null");
				return (0, Wu.encodeUTF8)(n);
			}, this.publicKey = () => t.publicKey, this.session = () => n.slice();
			let r = (e) => {
				switch (e.data.type) {
					case Rs.XBULL_INITIAL_RESPONSE:
						this.initialResponse$.next(e);
						break;
					case Rs.XBULL_CONNECT_RESPONSE:
						this.connectResponse$.next(e);
						break;
					case Rs.XBULL_SIGN_RESPONSE:
						this.signResponse$.next(e);
						break;
					case Rs.XBULL_SIGN_MESSAGE_RESPONSE: this.signMessageResponse$.next(e);
				}
			};
			window.addEventListener("message", r), this.closeObservables$.asObservable().pipe(Iu(1)).subscribe((() => {
				window.removeEventListener("message", r);
			}));
		}
		openWallet() {
			return this.target && !this.target.closed && (this.target.close(), this.target = null, this.closeCurrentPromises$.next()), this.target = window.open(`${this.walletUrl}?public=${encodeURIComponent((0, Wu.encodeBase64)(this.publicKey()))}&session=${encodeURIComponent(this.session())}`, "xBull_Wallet_app", "width=380,height=640,left=100,top=100"), tl(this.initialResponseCompleted$.pipe(Ru(this.closeCurrentPromises$)).pipe(Ru(this.closeObservables$)));
		}
		closeWallet() {
			this.target &&= (this.target?.close(), null);
		}
		async connect(e = {
			canRequestPublicKey: !0,
			canRequestSign: !0
		}) {
			let t = window?.webkit?.messageHandlers?.cordova_iab ? new Vu() : window.xBullSDK;
			if (t && this.preferredTarget === "extension") {
				let e = await t.getAddress();
				if (Ls(e)) throw e.error;
				return e.address;
			}
			{
				if (await this.openWallet(), !this.target || !this.targetPublicKey) throw Error("xBull Wallet is not open, we can't connect with it");
				let { message: t, oneTimeCode: n } = this.encryptForReceiver({
					data: JSON.stringify(e),
					receiverPublicKey: (0, Wu.decodeBase64)(this.targetPublicKey)
				}), r = {
					type: Rs.XBULL_CONNECT,
					message: t,
					oneTimeCode: n
				};
				return this.target.postMessage(r, "*"), tl(this.connectResult$.asObservable().pipe(Mu(((e) => e.success ? (this.closeWallet(), lu(e.publicKey)) : (this.closeWallet(), du((() => Error(e.message))))))).pipe(Iu(1)).pipe(Ru(this.closeCurrentPromises$)).pipe(Ru(this.closeObservables$)));
			}
		}
		async sign(e) {
			let t = window?.webkit?.messageHandlers?.cordova_iab ? new Vu() : window.xBullSDK;
			if (t && this.preferredTarget === "extension") {
				let n = await t.signTransaction({
					xdr: e.xdr,
					opts: {
						networkPassphrase: e.network,
						address: e.publicKey
					}
				});
				if (Ls(n)) throw n.error;
				return n.signedTxXdr;
			}
			{
				if (await this.openWallet(), !this.target || !this.targetPublicKey) throw Error("xBull Wallet is not open, we can't connect with it");
				if (typeof e.xdr != "string") throw Error("XDR provided needs to be a string value");
				let { message: t, oneTimeCode: n } = this.encryptForReceiver({
					data: JSON.stringify(e),
					receiverPublicKey: (0, Wu.decodeBase64)(this.targetPublicKey)
				}), r = {
					type: Rs.XBULL_SIGN,
					message: t,
					oneTimeCode: n
				};
				return this.target.postMessage(r, "*"), tl(this.signResult$.asObservable().pipe(Mu(((e) => e.success ? (this.closeWallet(), lu(e.xdr)) : (this.closeWallet(), du((() => Error(e.message))))))).pipe(Iu(1)).pipe(Ru(this.closeCurrentPromises$)).pipe(Ru(this.closeObservables$)));
			}
		}
		async signMessage(e, t) {
			let n = window?.webkit?.messageHandlers?.cordova_iab ? new Vu() : window.xBullSDK;
			if (n && this.preferredTarget === "extension") {
				let r = await n.signMessage(e, t);
				if (Ls(r)) throw r.error;
				return r;
			}
			{
				if (await this.openWallet(), !this.target || !this.targetPublicKey) throw Error("xBull Wallet is not open, we can't connect with it");
				if (typeof e != "string") throw Error("XDR provided needs to be a string value");
				let n = this.encryptForReceiver({
					data: JSON.stringify({
						message: e,
						opts: t
					}),
					receiverPublicKey: (0, Wu.decodeBase64)(this.targetPublicKey)
				}), r = {
					type: Rs.XBULL_SIGN_MESSAGE,
					message: n.message,
					oneTimeCode: n.oneTimeCode
				};
				return this.target.postMessage(r, "*"), tl(this.signMessageResult$.asObservable().pipe(Mu(((e) => e.success ? (this.closeWallet(), lu({
					signedMessage: e.signedMessage,
					signerAddress: e.signerAddress
				})) : (this.closeWallet(), du((() => Error(e.message))))))).pipe(Iu(1)).pipe(Ru(this.closeCurrentPromises$)).pipe(Ru(this.closeObservables$)));
			}
		}
		closeConnections() {
			this.closeObservables$.next(), this.closeCurrentPromises$.next(), this.closeObservables$.complete(), this.closeCurrentPromises$.complete();
		}
	};
})), qu, Ju, Yu = t((() => {
	Ku(), q(), Ma(), qu = "xbull", Ju = class {
		moduleType = K.HOT_WALLET;
		productId = qu;
		productName = "xBull";
		productUrl = "https://xbull.app";
		productIcon = "https://stellar.creit.tech/wallet-icons/xbull.png";
		isAvailable() {
			return Promise.resolve(!0);
		}
		async getAddress() {
			try {
				let e = new Gu(), t = await e.connect();
				return e.closeConnections(), { address: t };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				let n = new Gu(), r = await n.sign({
					xdr: e,
					publicKey: t?.address,
					network: t?.networkPassphrase
				});
				return n.closeConnections(), {
					signedTxXdr: r,
					signerAddress: t?.address
				};
			} catch (e) {
				throw $(e);
			}
		}
		signAuthEntry() {
			return Promise.reject({
				code: -3,
				message: "xBull does not support the \"signAuthEntry\" function"
			});
		}
		async signMessage(e, t) {
			try {
				let n = new Gu(), r = await n.signMessage(e, {
					address: t?.address,
					networkPassphrase: t?.networkPassphrase
				});
				return n.closeConnections(), r;
			} catch (e) {
				throw $(e);
			}
		}
		getNetwork() {
			return Promise.reject({
				code: -3,
				message: "xBull does not support the \"getNetwork\" function"
			});
		}
	};
})), Xu, Zu, Qu = t((() => {
	q(), Ma(), Xu = "hana", Zu = class {
		moduleType = K.HOT_WALLET;
		productId = Xu;
		productName = "Hana Wallet";
		productUrl = "https://hanawallet.io/";
		productIcon = "https://stellar.creit.tech/wallet-icons/hana.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Hana Wallet is not installed");
		}
		async isAvailable() {
			return typeof window < "u" && !!window.hanaWallet?.stellar;
		}
		async getAddress() {
			try {
				return await this.runChecks(), { address: await window.hanaWallet.stellar.getPublicKey() };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				return await this.runChecks(), {
					signedTxXdr: await window.hanaWallet.stellar.signTransaction({
						xdr: e,
						accountToSign: t?.address,
						networkPassphrase: t?.networkPassphrase
					}),
					signerAddress: t?.address
				};
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry(e, t) {
			try {
				return await this.runChecks(), {
					signedAuthEntry: await window.hanaWallet.stellar.signAuthEntry({
						xdr: e,
						accountToSign: t?.address
					}),
					signerAddress: t?.address
				};
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			try {
				return await this.runChecks(), {
					signedMessage: await window.hanaWallet.stellar.signMessage({
						message: e,
						accountToSign: t?.address
					}),
					signerAddress: t?.address
				};
			} catch (e) {
				throw $(e);
			}
		}
		async getNetwork() {
			throw {
				code: -3,
				message: "Hana does not support the \"getNetwork\" function"
			};
		}
	};
})), $u, ed, td = t((() => {
	q(), Ma(), $u = "klever", ed = class {
		moduleType = K.HOT_WALLET;
		productId = $u;
		productName = "Klever Wallet";
		productUrl = "https://klever.io/";
		productIcon = "https://stellar.creit.tech/wallet-icons/klever.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Klever Wallet is not installed");
		}
		async isAvailable() {
			return typeof window < "u" && !!window.kleverWallet?.stellar;
		}
		async getAddress() {
			return this.runChecks().then(() => window.kleverWallet.stellar.getAddress()).catch((e) => {
				throw $(e);
			});
		}
		async signTransaction(e, t) {
			return this.runChecks().then(() => window.kleverWallet.stellar.signTransaction(e, t)).catch((e) => {
				throw $(e);
			});
		}
		async signAuthEntry(e, t) {
			return this.runChecks().then(() => window.kleverWallet.stellar.signAuthEntry(e, t)).catch((e) => {
				throw $(e);
			});
		}
		async signMessage(e, t) {
			return this.runChecks().then(() => window.kleverWallet.stellar.signMessage(e, t)).catch((e) => {
				throw $(e);
			});
		}
		async getNetwork() {
			return this.runChecks().then(() => window.kleverWallet.stellar.getNetwork()).catch((e) => {
				throw $(e);
			});
		}
	};
})), nd, rd, id = t((() => {
	q(), Ma(), nd = "onekey", rd = class {
		moduleType = K.HOT_WALLET;
		productId = nd;
		productName = "OneKey Wallet";
		productUrl = "https://onekey.so/";
		productIcon = "https://uni.onekey-asset.com/static/logo/onekey.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("OneKey Wallet is not installed");
		}
		async isAvailable() {
			return typeof window < "u" && !!window.$onekey?.stellar;
		}
		async getAddress() {
			try {
				return await this.runChecks(), { address: await window.$onekey.stellar.getPublicKey() };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				return await this.runChecks(), await window.$onekey.stellar.signTransaction(e, t);
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry(e, t) {
			try {
				return await this.runChecks(), await window.$onekey.stellar.signAuthEntry(e, t);
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			try {
				return await this.runChecks(), await window.$onekey.stellar.signMessage(e, t);
			} catch (e) {
				throw $(e);
			}
		}
		async getNetwork() {
			throw {
				code: -3,
				message: "OneKey does not support the \"getNetwork\" function"
			};
		}
	};
})), ad, od, sd = t((() => {
	q(), Ma(), ad = "BitgetWallet", od = class {
		moduleType = K.HOT_WALLET;
		productId = ad;
		productName = "Bitget Wallet";
		productUrl = "https://web3.bitget.com";
		productIcon = "https://stellar.creit.tech/wallet-icons/bitget.png";
		provider;
		constructor() {
			this.provider = window.bitkeep?.stellar;
		}
		async runChecks() {
			if (!await this.isAvailable()) throw Error(`${this.productName} is not connected`);
		}
		async isAvailable() {
			return !!this.provider;
		}
		async getAddress() {
			try {
				return await this.runChecks(), { address: await this.provider.connect() };
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			try {
				return await this.runChecks(), { signedMessage: await this.provider.signMessage(e, t?.address) };
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				return await this.runChecks(), { signedTxXdr: await this.provider.signTransaction(e, t) };
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry() {
			throw {
				code: -3,
				message: `${this.productName} does not support the "signAuthEntry" function`
			};
		}
		async getNetwork() {
			try {
				return await this.runChecks(), this.provider.network();
			} catch (e) {
				throw $(e);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/@jsr+creit-tech__stellar-wallets-kit@2.3.0_@stellar+stellar-sdk@13.3.0_debug@4.4.3__@tr_a0fe2ce2d092366cd33ce6a2b8ecf30c/node_modules/@jsr/creit-tech__stellar-wallets-kit/sdk/modules/fordefi.module.js
function cd(e, t) {
	return new Promise((n, r) => {
		let i = ++dd, a = (e) => {
			e.source === window && e.data?.source === ud && e.data?.messagedId === i && (window.removeEventListener("message", a), e.data.apiError ? r(e.data.apiError) : n(e.data));
		};
		window.addEventListener("message", a), window.postMessage({
			source: ld,
			messageId: i,
			type: e,
			...t
		}, window.location.origin);
	});
}
var ld, ud, dd, fd, pd, md = t((() => {
	q(), Ma(), ld = "FREIGHTER_EXTERNAL_MSG_REQUEST", ud = "FREIGHTER_EXTERNAL_MSG_RESPONSE", dd = 0, fd = "fordefi", pd = class {
		moduleType = K.HOT_WALLET;
		productId = fd;
		productName = "Fordefi";
		productUrl = "https://www.fordefi.com";
		productIcon = "https://stellar.creit.tech/wallet-icons/fordefi.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Fordefi is not installed");
		}
		async isAvailable() {
			return typeof window < "u" && !!window.FordefiProviders?.StellarProvider;
		}
		async getAddress() {
			try {
				await this.runChecks();
				let { publicKey: e } = await cd("REQUEST_ACCESS");
				return e ? { address: e } : Promise.reject({
					code: -3,
					message: "Failed to get address from Fordefi."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				await this.runChecks();
				let { signedTransaction: n, signerAddress: r } = await cd("SUBMIT_TRANSACTION", {
					transactionXdr: e,
					networkPassphrase: t?.networkPassphrase,
					accountToSign: t?.address
				});
				return n ? {
					signedTxXdr: n,
					signerAddress: r
				} : Promise.reject({
					code: -3,
					message: "Failed to sign transaction with Fordefi."
				});
			} catch (e) {
				throw $(e);
			}
		}
		signAuthEntry() {
			return Promise.reject({
				code: -3,
				message: "Fordefi does not support the \"signAuthEntry\" function"
			});
		}
		async signMessage(e, t) {
			try {
				await this.runChecks();
				let { signedBlob: n, signerAddress: r } = await cd("SUBMIT_BLOB", {
					blob: e,
					networkPassphrase: t?.networkPassphrase,
					accountToSign: t?.address
				});
				return n ? {
					signedMessage: n,
					signerAddress: r
				} : Promise.reject({
					code: -3,
					message: "Failed to sign message with Fordefi."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async getNetwork() {
			try {
				await this.runChecks();
				let { networkDetails: e } = await cd("REQUEST_NETWORK_DETAILS");
				return {
					network: e.network,
					networkPassphrase: e.networkPassphrase
				};
			} catch (e) {
				throw $(e);
			}
		}
	};
})), hd, gd, _d = t((() => {
	q(), Ma(), hd = "cactuslink", gd = class {
		moduleType = K.HOT_WALLET;
		productId = hd;
		productName = "Cactus Link";
		productUrl = "https://www.mycactus.com";
		productIcon = "https://stellar.creit.tech/wallet-icons/cactuslink.png";
		async runChecks() {
			if (!await this.isAvailable()) throw Error("Cactus Link is not installed");
		}
		async isAvailable() {
			return typeof window < "u" && !!window.cactuslink_stellar;
		}
		async getAddress(e) {
			try {
				if (await this.runChecks(), e?.skipRequestAccess !== !0) {
					let e = await window.cactuslink_stellar.requestAccess();
					if (e.error) return Promise.reject($(e.error));
				}
				let { address: t } = await window.cactuslink_stellar.getAddress();
				return t ? { address: t } : Promise.reject({
					code: -3,
					message: "Getting the address from Cactus Link is not allowed, please request access first."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async signTransaction(e, t) {
			try {
				await this.runChecks();
				let { signedTxXdr: n } = await window.cactuslink_stellar.signTransaction(e, t);
				return { signedTxXdr: n };
			} catch (e) {
				throw $(e);
			}
		}
		async signAuthEntry(e, t) {
			try {
				await this.runChecks();
				let { signedAuthEntry: n } = await window.cactuslink_stellar.signAuthEntry(e, t);
				return n ? { signedAuthEntry: n } : Promise.reject({
					code: -3,
					message: "signedAuthEntry returned from Cactus Link is undefined."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async signMessage(e, t) {
			try {
				await this.runChecks();
				let { signedMessage: n } = await window.cactuslink_stellar.signMessage(e, t);
				return n ? { signedMessage: n } : Promise.reject({
					code: -3,
					message: "signedMessage returned from Cactus Link is undefined."
				});
			} catch (e) {
				throw $(e);
			}
		}
		async getNetwork() {
			try {
				await this.runChecks();
				let { network: e, networkPassphrase: t, error: n } = await window.cactuslink_stellar.getNetwork();
				return n ? Promise.reject(n) : {
					network: e,
					networkPassphrase: t
				};
			} catch (e) {
				throw $(e);
			}
		}
	};
})), vd = /* @__PURE__ */ r({
	defaultModules: () => yd,
	sep43Modules: () => bd
});
function yd(e) {
	let t = [
		new Ro(),
		new Cs(),
		new pd(),
		new js(),
		new Ju(),
		new Os(),
		new Zu(),
		new ed(),
		new rd(),
		new od(),
		new gd()
	];
	return e?.filterBy ? t.filter(e.filterBy) : t;
}
function bd(e) {
	let t = [new Cs()];
	return e?.filterBy ? t.filter(e.filterBy) : t;
}
var xd = t((() => {
	Bo(), ws(), ks(), Ns(), Yu(), Qu(), td(), id(), sd(), md(), _d();
})), Sd = "Test SDF Network ; September 2015", Cd = "Public Global Stellar Network ; September 2015";
function wd(e) {
	return e.network === "public" ? Cd : Sd;
}
var Td = class {
	config = null;
	listeners = /* @__PURE__ */ new Set();
	unsubscribers = [];
	themeMedia = null;
	themeListener = null;
	noirModule = null;
	async initialize(e) {
		if (typeof window > "u") throw Error("Wallet runtime requires a browser.");
		this.config = e;
		let [{ StellarWalletsKit: t, KitEventType: n, Networks: r }, { defaultModules: i }] = await Promise.all([Promise.resolve().then(() => (Qa(), Za)), Promise.resolve().then(() => (xd(), vd))]), a = i({ filterBy: (t) => e.walletIds.includes(t.productId) });
		this.noirModule = e.walletIds.includes("noir") ? new oe() : null, this.noirModule && a.push(this.noirModule);
		let o = e.appearance.theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
		t.init({
			modules: a,
			network: e.network === "public" ? r.PUBLIC : r.TESTNET,
			authModal: e.modal,
			theme: f(e.appearance, o)
		}), t.setNetwork(e.network === "public" ? r.PUBLIC : r.TESTNET), this.unsubscribers.forEach((e) => e()), this.unsubscribers = [
			t.on(n.STATE_UPDATED, (e) => {
				this.emit({
					type: "changed",
					address: e.payload.address ?? null,
					walletId: null,
					networkPassphrase: e.payload.networkPassphrase
				});
			}),
			t.on(n.WALLET_SELECTED, (e) => {
				this.emit({
					type: "changed",
					address: null,
					walletId: e.payload.id ?? null
				});
			}),
			t.on(n.DISCONNECT, () => this.emit({ type: "disconnected" }))
		], this.removeThemeListener(), e.appearance.theme === "system" && window.matchMedia && (this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)"), this.themeListener = (n) => t.setTheme(f(e.appearance, n.matches)), this.themeMedia.addEventListener("change", this.themeListener));
	}
	async listWallets() {
		let { StellarWalletsKit: e } = await Promise.resolve().then(() => (Qa(), Za));
		return (await e.refreshSupportedWallets()).map((e) => ({
			id: e.id,
			name: e.name,
			isAvailable: e.isAvailable,
			url: e.url
		}));
	}
	async connect(e) {
		let { StellarWalletsKit: t } = await Promise.resolve().then(() => (Qa(), Za)), n;
		if (e) {
			let r = (await t.refreshSupportedWallets()).find((t) => t.id === e);
			if (!r || !this.config?.walletIds.includes(e)) throw new h("WALLET_UNAVAILABLE", "This wallet is not enabled for this app.");
			if (!r.isAvailable) throw new h("WALLET_UNAVAILABLE", `${r.name} is not available.`);
			t.setWallet(e), n = await t.fetchAddress();
		} else n = await t.authModal();
		let r = t.selectedModule?.productId ?? null;
		if (r === "noir" && (await t.getNetwork()).networkPassphrase !== this.requirePassphrase()) throw new h("NETWORK_MISMATCH", `Switch Noir to ${this.config?.network === "public" ? "Mainnet" : "Testnet"}.`);
		return {
			address: n.address,
			walletId: r
		};
	}
	async restoreSession(e) {
		try {
			let { StellarWalletsKit: t } = await Promise.resolve().then(() => (Qa(), Za));
			return e.walletId && t.setWallet(e.walletId), e.walletId === "noir" && this.noirModule ? await this.noirModule.hasMatchingSession(e.address, this.requirePassphrase()) ? e : null : (await t.getAddress()).address === e.address ? e : null;
		} catch (e) {
			if (e instanceof h && e.code === "NETWORK_MISMATCH") throw e;
			return null;
		}
	}
	async disconnect() {
		let { StellarWalletsKit: e } = await Promise.resolve().then(() => (Qa(), Za));
		await e.disconnect();
	}
	async signTransaction(e, t) {
		let { StellarWalletsKit: n } = await Promise.resolve().then(() => (Qa(), Za));
		return (await n.signTransaction(e, {
			networkPassphrase: this.requirePassphrase(),
			address: t
		})).signedTxXdr;
	}
	async signAuthEntry(e, t) {
		let { StellarWalletsKit: n } = await Promise.resolve().then(() => (Qa(), Za));
		return (await n.signAuthEntry(e, {
			networkPassphrase: this.requirePassphrase(),
			address: t
		})).signedAuthEntry;
	}
	async signMessage(e, t) {
		let { StellarWalletsKit: n } = await Promise.resolve().then(() => (Qa(), Za));
		return (await n.signMessage(e, {
			networkPassphrase: this.requirePassphrase(),
			address: t
		})).signedMessage;
	}
	subscribe(e) {
		return this.listeners.add(e), () => this.listeners.delete(e);
	}
	destroy() {
		this.unsubscribers.forEach((e) => e()), this.unsubscribers = [], this.removeThemeListener(), this.listeners.clear(), this.noirModule = null;
	}
	emit(e) {
		this.listeners.forEach((t) => t(e));
	}
	requirePassphrase() {
		if (!this.config) throw Error("Wallet adapter is not initialized.");
		return wd(this.config);
	}
	removeThemeListener() {
		this.themeMedia && this.themeListener && this.themeMedia.removeEventListener("change", this.themeListener), this.themeMedia = null, this.themeListener = null;
	}
}, Ed = {
	albedo: "data:image/png;base64,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",
	freighter: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAYKADAAQAAAABAAAAYAAAAACpM19OAAAOYElEQVR4Ae2dC5AUxRnH/7uHPAVE5KmCggoooqaUwiiKJiYmVkCwiBotlVRMNJrERA3GaMSKQbBMylgSk4oRRI0G9VQwlq+I+MCoCAI+CgVEEI73ARJEYG/y+3ZuuL1lHzO3u3M7dftV9c6rp/vr/9ffo3t6dmIqlMY6VUqou+rUg6J6kQ6SoyPY9lcsedyV/c6k/Ulx0gH1WzZlR3VwtIVk2y9I/yOtpR3raNNy0lL2N3CuhpasU5XW67FYguMmU6xJd450equVRsDmmTB0Aoz1oZwu7FclIbZCnfpk+0Z2HCVKRcb2vWMTjUOXk2pJq0gLuPYyZ2ZrZmwNx4HIK9bfTaOdwWS8CgbGAHX35E0e0FED2F+Ls+fyhOIhWIdGSI+TpujJ2EfZb2x8xbu98dn0o5FORwC/gdNX08M7JRW0pQGejkn6sSFpBjahbfxO0X6ajHnamp4t/Ti/AM51hlLwFNTsxArw6fBlODZEq0h7ME2OrtTTsbcy5Np7KrcARjnnA/69pC5Jq7f3tspOXgRMGxz8REI/xTc8mi1/dgGMcsYhyb9SSGtShZqCgIvuLizHFWjC1ExFZBaA9fwqTa+AnwmygOcM4Zh2I4SL9VRsRvrd+wpgjHMSwL9Ixs6Vnp8OVxOPXXO0Fb9wlmbF3kktpbEAxjqdkdUcev9xFZufClMR9s0xJ3DMdTodn2CDvCSZbBpot8YzwKqA34BI8fZs6FbFoDUGxinUoAGjnaM4P4/UsWJ6UhAq5q6L9nZM0TBM0QdWdIMGOLqGowr4xQQ8vSyLJuPMiVXp594lVybfdnqpnRajHl0rvd+DpkRbQ9zRRgQxRNWxGlcD2uoMpFIBv0SYNyrWtKCKGeMEmEOuAOL6ZqNMlYPSIxBjJhmKa4TTCpWwKeUKhYWAi/XXDPu4uqEO0qEtWgBhdz63vj5qr4Pi+ir51OqAFisAwGjNIImuGB65AujCLFvPOA6hB9GPjdNaJu2R7vmR9I1jaP7uECGIJf1vrzg9v1u9Kw6x9jKpCsBPHij98FtS947wFKYpcjUOEyQdGWrFZYK9tbnNftKkS4gK0f+eXWDMnveGSSxeiGN++oVZZ9nU9ZV07bnSaUNcjgYcwtYdlobDoqtt/c0E9WxxGgD43x0q3XxBA9aDD0MTWjccl3zPBBAXPkDJ9Twlr69sKgD8odj9+6+R2rZp4OroQ6W+FpAXtMqnoTxfe466mgBswVRxKEwn1hSOd0rDWVhTfSO9zmx+CnXsII3gGjOVYVJnVwDFAI6e085U2BwZDdWu+n02zU4GKhHPOKKdWbdIB1tPz0AXDMcqhBWQu5jv3wo+TAiFEY07H+ZvvYh1fJukN1mW9Cpp/qfSus0UbUKxmsJqnNcaMyfwdiQOdsKF0g/O9C5k3p6OQz7pKOmtJVwnQgqB4jGd6xibhQkBu/rQddJFaQ008N+mMc/ymOelhdLStdRkkrfGlSLiMEFbshYh7GMA/jKmGcedJXXtxDkfVP26dN4kMoYjgDoTgKsMPpjLmgUVP3kAIN8mtW+bOdfW7dJr70v/nCM9t4CFlbZ+rBhaQQ83qqKsztjx/iyYPAVezj5ROpXRbYd27nW/vwmEN2aiNPNN7khx0n7vD5qvOAKwWtGC28dJN4zNz8LyGjTmZekBku03VRBxevtNY4jlj2XJNeD3ZB22OddWBZq6ZWsok4WYa2z5rXWSElKVBk6YUJTyMWLzPpZGEl93swXoOagLw36ztxePYD07gH2yGo2wReFmCAOYJtNd67HW04dTXqf2FFGYMU1yfSD8DTqYaAkt2IOQg/CULCDAT/EEAHBffSl9tt51yH6AMHM1bJB04WluBLUIp72TMnw7a+pcSX0PzUGIq4jvcaBmhopBRyIAGxc8+44r5AK9ZFaWiicAqwLVNyAOxw4f3z9rnftcMDt9xnHSOdhtA9TKSPY6P9pgPZ60eJn0FMtgbUDVv9c+VTTpxHH9pKN6S//BZ+200Jr2FZuKK4B67t5dihac6pqEIAyb/T4fbTiQoeEbHzKUsLGEX5OCrd7Ccqcn5ro9dwjgFYOO6UvnwLzNp001dI6kEPx0DJ+VF18AALaNCKd2uzTqZJ9cpGQz0zVsoJKj0rmMJTaaI/Tb87h3Nz7hGTShXw9pyOEpBRewawM3G6QZvbc8YMdwb8v6W7woKLUKnGMVzmvmTe6kV+qlIPurN0qX/gkT8B53BQkJqbsDcfysm13TFqTOfHk/+ky68i/SHDS0GBFSaQRgrdgjDe4jvT4Zx4hJaSpt5TW5SxBC4Lic+o/AF1j96fM+QXhZu1n6ENDfXyF9uk7ahGa/jTlaYuEzGlcolU4Axhljg998X5p4WWFsfkFkdNGd9GjCwkCagOO84hzp3quD1b9pK3VhxqrxJ28tk9ZbiIxpS5LZfxsbFAF8K6+0AsAUtcd+vzKROZYBVl3TyUbSo/8gzV5EGa19lkP9bQHqtdulE33Ub9r2t38jsOekFWupo8hgZ+K6SHLMVLTbgB1owbX3owz1UwZZcuY9bWZs+q+YWCM+9z1lDIAWPt49K2/xeuFdRr+/lsZPBfyN5G9DMkGXFqFSF08DcIavLXZ7FkcF0SHdpH/8DK0yYOjdvoi8swB3BfY7I1HOpBnS926TFq0kh81l+Y26MhYY7GSJ5VvPDEL4PY1cujoYc5lyDz+W+R/8SvJ5Q6YM6efQgi3Y9BfmpV/ArBMt/eI+/NQ0ijOBmm0PmcIRALVsxJHd8AAd12/PzQHEL0dLX2f+x/c6HoTwnIWyaXTTdMzTk5w0jSJPc1A4ArCWYVMtqpjxauHNbAtgky6lSDTLlynCpCxcwZ8/7Gio+/7npcmPc9yM4Bs34QmAyhxqu/FBwjob3RZI9mx37CkUYtMV+Yh6a6jz8w1uxsXLpesIDPibkWbr+R7LoQrAnNty/MCtj3jVF7a9nmcB7dtRRj6zhnn5kmjMRtZ15LWozKZKwu1+mdsargCMB0zRfS8Qz2ewyZlZzH7WJtxGDeW6nxCXgdQOtMVG1C8u4B4zPWVA4QuA3riLaYJrp/JnPDb3XyBdfjZRo5mSfERLZ7wh/c60z0/+fOUV6Xr4AjDGcZ4LPpH+aBFIgXTK0Tx7QBPyDs6o8+E5PDdYSd4WLwADHUDufIrohLmWQqg15YwZRgneXE2uwoo4h5OrmiDXmkcDjENq/oK5l+unYcIxSYWQPUlrYyPYfM64kEpKdG/zCcAahCN8cb40FadcCA3qKw08hBL8aEEhFZXg3uYVgDUIezzhUZ4FZ5ur8dFoM0OnDiBjRQA+0ErPggBqiM9vnJ5+IdixOePmmk4Ixmnj3M2vAcYPpuiRV6Wn5zZmLsjR4MMoxs+gLEihIeQtDwEwNmBiUuMfkDbzQL8p1Iep6t6dudMKihCVhwAMMELEJSt5fMm0dVOoUwfpsIO4M2KRUPkIwFBnmmLKs9LcD4KLIIYW9e3OfRUNCA7e3jsAcSfzNdcxTWGTZ0GpT0UAQSHLkJ+Q8s0P0YRnMlzLc6q7+QCEGCUqLxPkIYcQJj4mfYRPCEJdKwIIAleOvHSLWtZ5jp/G2CrA4MreEahoQA5cA11ibDDrbd6oecX/XcnVEuWp01kbUd7swt1vH+JNFUbKfqg19j9iLqAcHsrlgJZpilVrpVsezpEn5VKcMUBFACmAFGWXscG0l6Xn5+UvjVcOozYOS2pAeQ9dAHUPjtieG2zj+UEussVVERsI15kP2JKrUWVxjbDUXkG644nc3NhD94iNhLeYAMpbAzzMMUV3zXTfxPROpW+37eBMtFQgqQHbI+G5MEW2isKmKXZlWYZiY4fICMCNFrabBrB0NSLE2GDOQunvrN/PRJujJAC3AQggJl7CiRDhD27lEebyNfvyvM68mduz9r1YnmfWxvEAayLFNDq7oZaV1tOxNmn2Pjlgi4oAXD7XmwlaFikBWE/GIT/+Bu8Ev97QresIJZL/7WAtig4tMxO0NDr8NnDq0INMCzbUB9E7eBVpje1HRQCuBnxi7G6MSCDagL7tMU2xbDV/vPcg758R//93CasrouQDLPjnu5T2luTx7PIWVWT6DqymEH5gSG/mjAC/1kbKUdEAW8VUp5PivODAdBcfHIuK80rBPrkL34s+pwE2CIsK+C7WW/BlfMBhByaIhWmRFYBJAXMUKf5dAaziw7gb43olZktj50eqAQZ6lMkEEOOTVmDvKq3D93ArFC4CdXrJKnQFUMXHiBOYIlc1wmWkpdVmGCe0if9WnW1NdwXA13zYr46MEzPOo0ou4jP0fBLzFMgTupuwKBozo1EF33p/Hd+qj+kurwmuPOzIvuxWpz+niMTLU9kWCwGL1hzdwyfPP/aKbBCAnXH4DLd9cNIyVqi4CBime7SQd+MmpxbcWAD2lc+EfoImbK1oQipMBe67pscwvTz9O/ONBWD12PduHf2Yvd2VqKhA4O12Az/GfEMdHbu68beE7fK+ArCz9uVn0wT7JwYroEJNQ8ADP5H8pPm/MhWSWQCW076BntCl7NVmEVOm8irnPARcP1oLhpdk+568Zc0uALs6M/YoqvMd0oLknxlVtMFQyU2GkRvtzMOUnw34GXu+V4g/SN1PnY/npqsovBMCic7qA6+lpd4aktad62Rvud1Dz5+U+unybNX7E4B392hnEFK9Gr9wHpX1SJ6257Je8vK1hK0h5yVrb0LrOa5mbwpx/vt2yg8FE4BX4kinN5pwBsCfyakTSIeSusBA1V6jli4UO44SpSKTCrSr/fbWgj1DWQkGC9jaXNpsenyGtRq5G51aTe6c2a6O5X+nEuqO6plG9IKhbjB0BKkf+3auJ8lenehIMiU9oH7LpuzI4OXZWtLIbmdra6Y20Q6bK7PFC/b83J6f1NCSdXS39cT1Jowm0/8BX650pjCQVu8AAAAASUVORK5CYII=",
	fordefi: "data:image/png;base64,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",
	rabet: "data:image/png;base64,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",
	xbull: "data:image/png;base64,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",
	lobstr: "data:image/png;base64,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",
	hana: "data:image/png;base64,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",
	klever: "data:image/png;base64,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",
	onekey: "data:image/png;base64,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",
	BitgetWallet: "data:image/png;base64,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",
	cactuslink: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAMS2lDQ1BJQ0MgUHJvZmlsZQAASImVVwdYU8kWnltSIQQIREBK6E0QkRJASggtgPQiiEpIAoQSY0JQsaOLCq5dRLCiqyCKHRCxYV9ZFLtrWSyoKOtiwa68CQF02Ve+d75v7v3vP2f+OefcuWUAoLfzpdIcVBOAXEmeLCbYnzUuKZlFeg4QgAJN4Ais+QK5lBMVFQ6gDZz/bu9uQG9oVx2UWv/s/6+mJRTJBQAgURCnCeWCXIgPAoA3CaSyPACIUsibT82TKvFqiHVkMECIq5Q4Q4WblDhNhS/3+cTFcCF+DABZnc+XZQCg0Q15Vr4gA+rQYbbASSIUSyD2g9gnN3eyEOK5ENtAHzgnXanPTvtBJ+NvmmmDmnx+xiBW5dJn5ACxXJrDn/5/luN/W26OYmAOa9jUM2UhMcqcYd0eZ08OU2J1iD9I0iIiIdYGAMXFwj5/JWZmKkLiVf6ojUDOhTUDTIjHyHNief18jJAfEAaxIcTpkpyI8H6fwnRxkNIH1g8tE+fx4iDWg7hKJA+M7fc5IZscMzDvjXQZl9PPP+PL+mJQ6n9TZMdzVPqYdqaI16+PORZkxiVCTIU4IF+cEAGxBsQR8uzYsH6flIJMbsSAj0wRo8zFAmKZSBLsr9LHStNlQTH9/jtz5QO5YycyxbyIfnwlLzMuRFUr7LGA3xc/zAXrFkk48QM6Ivm48IFchKKAQFXuOFkkiY9V8bieNM8/RjUWt5PmRPX74/6inGAlbwZxnDw/dmBsfh5cnCp9vEiaFxWnihMvz+KHRqniwfeCcMAFAYAFFLClgckgC4hbu+q74JWqJwjwgQxkABFw6GcGRiT29UjgMRYUgD8hEgH54Dj/vl4RyIf81yGskhMPcqqjA0jv71OqZIMnEOeCMJADrxV9SpLBCBLAY8iI/xERHzYBzCEHNmX/v+cH2O8MBzLh/YxiYEYWfcCTGEgMIIYQg4i2uAHug3vh4fDoB5szzsY9BvL47k94QmgjPCRcJ7QTbk8SF8qGRDkWtEP9oP76pP1YH9wKarri/rg3VIfKOBM3AA64C5yHg/vCmV0hy+2PW1kV1hDtv2Xwwx3q96M4UVDKMIofxWboSA07DddBFWWtf6yPKta0wXpzB3uGzs/9ofpCeA4b6oktwg5g57CT2AWsCasHLOw41oC1YEeVeHDFPe5bcQOzxfTFkw11hq6Z73dWWUm5U41Tp9MXVV+eaFqe8mHkTpZOl4kzMvNYHPjFELF4EoHjCJazk7MbAMrvj+r19ia677uCMFu+c/P/AMD7eG9v75HvXOhxAPa5w1fC4e+cDRt+WtQAOH9YoJDlqzhceSDANwcdPn36wBiYAxuYjzNwA17ADwSCUBAJ4kASmAijz4TrXAamgplgHigCJWA5WAPKwSawFVSB3WA/qAdN4CQ4Cy6Cy+A6uANXTwd4AbrBO/AZQRASQkMYiD5iglgi9ogzwkZ8kEAkHIlBkpBUJAORIApkJjIfKUFWIuXIFqQa2YccRk4iF5A25DbyAOlEXiOfUAxVR3VQI9QKHYmyUQ4ahsahE9AMdApagC5Al6JlaCW6C61DT6IX0etoO/oC7cEApoYxMVPMAWNjXCwSS8bSMRk2GyvGSrFKrBZrhPf5KtaOdWEfcSLOwFm4A1zBIXg8LsCn4LPxJXg5XoXX4afxq/gDvBv/RqARDAn2BE8CjzCOkEGYSigilBK2Ew4RzsBnqYPwjkgkMonWRHf4LCYRs4gziEuIG4h7iCeIbcRHxB4SiaRPsid5kyJJfFIeqYi0jrSLdJx0hdRB+kBWI5uQnclB5GSyhFxILiXvJB8jXyE/JX+maFIsKZ6USIqQMp2yjLKN0ki5ROmgfKZqUa2p3tQ4ahZ1HrWMWks9Q71LfaOmpmam5qEWrSZWm6tWprZX7bzaA7WP6trqdupc9RR1hfpS9R3qJ9Rvq7+h0WhWND9aMi2PtpRWTTtFu0/7oMHQcNTgaQg15mhUaNRpXNF4SafQLekc+kR6Ab2UfoB+id6lSdG00uRq8jVna1ZoHta8qdmjxdAapRWplau1RGun1gWtZ9okbSvtQG2h9gLtrdqntB8xMIY5g8sQMOYztjHOMDp0iDrWOjydLJ0Snd06rTrdutq6LroJutN0K3SP6rYzMaYVk8fMYS5j7mfeYH4aZjSMM0w0bPGw2mFXhr3XG67npyfSK9bbo3dd75M+Sz9QP1t/hX69/j0D3MDOINpgqsFGgzMGXcN1hnsNFwwvHr5/+O+GqKGdYYzhDMOthi2GPUbGRsFGUqN1RqeMuoyZxn7GWcarjY8Zd5owTHxMxCarTY6bPGfpsjisHFYZ6zSr29TQNMRUYbrFtNX0s5m1WbxZodkes3vmVHO2ebr5avNm824LE4uxFjMtaix+t6RYsi0zLddanrN8b2VtlWi10Kre6pm1njXPusC6xvquDc3G12aKTaXNNVuiLds223aD7WU71M7VLtOuwu6SPWrvZi+232DfNoIwwmOEZETliJsO6g4ch3yHGocHjkzHcMdCx3rHlyMtRiaPXDHy3MhvTq5OOU7bnO6M0h4VOqpwVOOo1852zgLnCudro2mjg0bPGd0w+pWLvYvIZaPLLVeG61jXha7Nrl/d3N1kbrVune4W7qnu691vsnXYUewl7PMeBA9/jzkeTR4fPd088zz3e/7l5eCV7bXT69kY6zGiMdvGPPI28+Z7b/Fu92H5pPps9mn3NfXl+1b6PvQz9xP6bfd7yrHlZHF2cV76O/nL/A/5v+d6cmdxTwRgAcEBxQGtgdqB8YHlgfeDzIIygmqCuoNdg2cEnwghhISFrAi5yTPiCXjVvO5Q99BZoafD1MNiw8rDHobbhcvCG8eiY0PHrhp7N8IyQhJRHwkieZGrIu9FWUdNiToSTYyOiq6IfhIzKmZmzLlYRuyk2J2x7+L845bF3Ym3iVfENyfQE1ISqhPeJwYkrkxsHzdy3KxxF5MMksRJDcmk5ITk7ck94wPHrxnfkeKaUpRyY4L1hGkTLkw0mJgz8egk+iT+pAOphNTE1J2pX/iR/Ep+TxovbX1at4ArWCt4IfQTrhZ2irxFK0VP073TV6Y/y/DOWJXRmembWZrZJeaKy8WvskKyNmW9z47M3pHdm5OYsyeXnJuae1iiLcmWnJ5sPHna5DapvbRI2j7Fc8qaKd2yMNl2OSKfIG/I04E/+i0KG8VPigf5PvkV+R+mJkw9ME1rmmRay3S76YunPy0IKvhlBj5DMKN5punMeTMfzOLM2jIbmZ02u3mO+ZwFczrmBs+tmkedlz3vt0KnwpWFb+cnzm9cYLRg7oJHPwX/VFOkUSQrurnQa+GmRfgi8aLWxaMXr1v8rVhY/GuJU0lpyZclgiW//jzq57Kfe5emL21d5rZs43LicsnyGyt8V1St1FpZsPLRqrGr6lazVhevfrtm0poLpS6lm9ZS1yrWtpeFlzWss1i3fN2X8szy6xX+FXvWG65fvP79BuGGKxv9NtZuMtpUsunTZvHmW1uCt9RVWlWWbiVuzd/6ZFvCtnO/sH+p3m6wvWT71x2SHe1VMVWnq92rq3ca7lxWg9Yoajp3pey6vDtgd0OtQ+2WPcw9JXvBXsXe5/tS993YH7a/+QD7QO1By4PrDzEOFdchddPruusz69sbkhraDocebm70ajx0xPHIjibTpoqjukeXHaMeW3Cs93jB8Z4T0hNdJzNOPmqe1Hzn1LhT105Hn249E3bm/Nmgs6fOcc4dP+99vumC54XDv7J/rb/odrGuxbXl0G+uvx1qdWutu+R+qeGyx+XGtjFtx674Xjl5NeDq2Wu8axevR1xvuxF/49bNlJvtt4S3nt3Ouf3q9/zfP9+Ze5dwt/ie5r3S+4b3K/+w/WNPu1v70QcBD1oexj6880jw6MVj+eMvHQue0J6UPjV5Wv3M+VlTZ1Dn5efjn3e8kL743FX0p9af61/avDz4l99fLd3jujteyV71vl7yRv/Njrcub5t7onruv8t99/l98Qf9D1Uf2R/PfUr89PTz1C+kL2Vfbb82fgv7drc3t7dXypfx+34FMKDc2qQD8HoHALQkABhw30gdr9of9hmi2tP2IfCfsGoP2Wfwz6UW/tNHd8G/m5sA7N0GgBXUp6cAEEUDIM4DoKNHD7aBvVzfvlNpRLg32Bz9NS03DfwbU+1Jf4h76BkoVV3A0PO/ACpBgx+bxLm0AAAABGNJQ1AMDQABbgPj7wAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAKgAgAEAAAAAQAAAGCgAwAEAAAAAQAAAGAAAAAA2gCLsQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAmxpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDYuMC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIj4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjI1NjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj4yNTY8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8dGlmZjpZUmVzb2x1dGlvbj43MjwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6WFJlc29sdXRpb24+NzI8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOlJlc29sdXRpb25Vbml0PjI8L3RpZmY6UmVzb2x1dGlvblVuaXQ+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgp0Un7uAAAiH0lEQVR4AeVda7BeVXnel++ck+SEJIQoxoq3UipaLlaRiqgHSaDYevlDC8rVOrTDDAoE8DYqaqvcQpjaEevUIRAVp/xwBmfoUAIE5VJERGAQaFGLYUQlEEjOOTmXb+/d53nWete39s73feec5CTQYSXfXms961nv+653rb32be190uQlHEYurlrJ2NiKVjG4sigmDkjz5KA0yQ5L0+rPqrJ8bZKkS2V+mryA9OYsyR9uV+2HkjR5PC3zp8qB6rfJ8PCWTRen7ZdqM9OXkmGrPlUtTaa3HZykA0ckSXlEkqZvoqPTNFuG9BCcn1T8VxUJNjC9RIwm6H+WpFmOdIoi4tVkUpXPJ1m2uSqLx5KsdV+StO8r2sWjm67a9/mXSrtf9A5497ljKwez9D1pVr0fPn1XWlWvz1pDOd2blG052zsUAM1VSS3pegA4i9ABLoEOQYelOX7Ydcgpi8kCHfYkgLvQbze1Bqs7bv7q8NMofNHCi9IBmFoWZNvHj8nS5CQ4bXWatVZilMNB03A4Zgv5OHY0zEzpYHMu/KWkx+U+pLVX+DJifu/o4Kn2kiwbBFRiBymeTtN0Izrk+6PtodvvWZfukKi9uGEz9loYWbNtRSttnQSFZ8ADb8vyQTh9Co5oTNGyipsuTvd7QQXnYrJxHeExdZyvJqgfzv7NcNTIh5KynEImfQDQ+qnJ4voff32fZwDslbBXOuDYz2zbL20Pngmn/0OWtf4YI881miPWHKbm+kxsFR1lpG449wwLIQniHPEsH8De0YJd07/GlPXNiYmpa/ZGR8RNsmbMW3zixdXg82MTp2FvvzDNWwdVHO2aYrxaTSuxOjMneNIX0qFI2hQTqnThi0dCSDi2sl34Ku3g7IQUe2ZVtJ+o0vSKYsvT125a/4YJJ2T+t6Z53iWvWrPtaJzNfAVz+wjPWirM73IKNTYdqQOn4SI4e+aK0+k28uPjxWxwcoJdmN5ydETaAtT+cVoUn79l3T53OKPmd8vWzmsYOfsPiwcW7XNRVVUXpHm+sJxuDB47S+Egp3Yb7DU8coZZKH4Dt7rmYOPo2MFmgW97WVO+cZryg0HOtqy1AJ1QTOBgfeXCdMElN16Wbqfk+Qqmfl7krb5w9PCkan0du/HRZbEDB1d4RA4wNeYxc0w/3HNJ0dkM8vGojnFZD8BGcBCLhHiRLOMybvJF3hnn6WzWWsjjwz1FVZ5z+9rh+yVmHjZm6m6LOnbNjo9ikF2Fi6EV5TTO5tTwSKzlLbYijkxzRMCY8MSm0z2++2dBUacwSXUMobORNkw4TprQCbD12bIq19y6duG1hHc3xCp2SdaJJ1b5c68d/XKWtj6Nc+ssnFJSctN51tDZ4rRIfpIwZ59ZHOM1jDTPnw0uahe+BgZlQZHkYIOBkmYDlI8Ztrh8+ebhz95wQ4rL8l0PEr2r1Y+7oBoukylMOdmZZZtzPW8BeGlqEzbSALCJk2bzs6/iycgZ2Qq8nOaeEoZoxJde1gsJJ0RZbhgivvKzxE0kLhp5bMCV+rXj2eg5d132il0+LphmmTGXzci5W5e1WkPrcTH1oWJ63DUqtAtiJRlAwCjd401H6gBJESSzoq80V1zyfd14L5sNTk6wi3ZCjszpjeetRUlRTv1wcmzq9DuvXrYVhs85sLVzDiPnVnD++PW4pP9LOZ9SfLuDMDnPNyKASMR4XK+GR41ucsxJMW4Olg0oMOfFeFM+DSafchiU9kINZ8xQq4t8hGfohKqc/s+xYurke9YtfU78OWyyOXBF5bQD56/PsiHnfKI6cDHBBvgW2WhWtgeuUdqFbw6gSAY6gLReOB1ues07XmzA446jTOMHZwqs45Rhcoxnqrw95fQY7mgMHDecDVzDU3CTMtt4Th3A+/NFNf4vaT70oaI95nTIQFglA7GRM7zhbPSMeGSq8c2haiQ2XXCeBYUpI55uVCeSab3WxNUhAGM86CEYhcBt4JSNwVG0x3n1/MF8weKr33ZWxaP0rMOcOiDfPv4lzPlnlJrzYx0dw+TvMGxmg7sarornA+J9fxcYx3IcrhtxxFVMdocjfg13dQLOSjatUAnT4iOSGF+uTvbqe+Gsj8olOiFrDZyybPHYPwqa5Sa2um+VY9eM4jw/vw6X5rhvbA2iodLfaYSkGI5CK58JV3nHHGpwTmbBDDj2mHBdIDm+zk64k2M7DJ6sOcd7+QFXb3T0EtdO2cA7baO1CDg7wu0L7C/TZ966dsm1Duy/7bSsD++Y80cPy7N8I867VuAmVZ0ZS/B2yGHCPdDEuUuz3HCNRuYJRAX9cNXtwg+yG3Ikm6bvCZy2Uzak42YeNs+V7XL1bVcN/8yhvbczTkEjZ1eLszS9GqN/RbjIiuV5xWaAKwLYDzcfMGYw5yiPirHjzaEUWOPHClBgdTskCI5wyjQO49mkaZvpjflNnKaoHGw828DdgOV4CHf1By+q9hG1z2bGDmgtHP1Ulg+9k/d2wtmOHOQ1SrilGVs6skpYA2dW+7zH1QlIC4/EmPxuuDlVUwkI6hNsYtXUwTzlG256hbPM62vi1Cm9JiPiGg5IwWQA560YPOh5x1h7/DNW3CummJ7hfedvOyrPBm4py2JRkvBBuKdaLRoc5tGozIwxPotYpyuOAtsDvAhxrYKc4gVJrxdkuLLYmB2+uHNgRd3Yznjvoo5QD+naIEA9yuKmH0553rwogWo594SJpJpevXHtkjutac245x5wwjkVViGkl0AKrjTsdgeU0aidFBJ0wfnS8hb7NrgWgRjjXpggjwPCzRaT2OETD8pZDr537ot2FiQzsIntZxpPofAsBPey00veed5m3MXrHnp2QNEaPwVTz7vL9mS9pkaeb3gooQHUyue00h5KZoeDzoYoODnOuYYx9jj1B25Ubphiy6DckhYLwvkV82aqL1MnGo8EliP0wiMCSMZ3dlIM74/hmuldwwPLT5WgLhuvol5y/HnV8iIdvxeXeAfyMaKCMc1Aq2I486EMoHAPNHEz1vDmtGCC+uGqyw0VeUGaDpAW1AWnjd34u41DgDehKZ9P1VD4q3ZSHLlp7ZItUhVtuu4BRTr2saw16JwvR8YKotpMmmKLVYyM5S2OcfNN7GDypAuJGs48KzfwmgIQjOMSjs+04ZQZ0rGuPmkUOb0NThMPtjf4GGhVNZ3g4vWNcPTHVa2xkUkxphUMU/l9cMIbdNpJ4Wo8IzbCa4txtoyj2rWww++HU6amM9DNmXK8x+3gyOKAM92hB1x6SJRRTHieNa8/zlJTESuo45KqTS88bn6HDYlYcYFnJU9OTVVHNFda7LwHTOYnpdngG9xDdKgyh5tqaleHyAynR86PcQe7TumBBzmeKxpAifWy5T/fuR6Sg2Lci3d2ImM+t4TZH+NKd3S4IiMAV29YZDhle6YijzMSjgRF8scQ4bhbytPS1w0O5Se7ws621gHvPK9amKblx7X2kgJMWEgA7IeziuqQxOD5SO2Eq5y4V6Iqvh6ggEt3hAdbWA+43yvn7SxIMiGbTrUDvtQz3wXXXkzcN4gR06rrcUQlF59Vxd994Kzf4pS+E2odsLDaNoKDxqGVWykGFpXGkiFJ0nvj9bOgDn8n3I+aIJ3U4GyPCmvgxISDIxo3+BlXsc8wquGUhYA2qd9ZVRxH0h1WEYgD097DpBS5EuGeJBw8kxH2BN7FYn2TgzyW5aRJ65Adi5Ye42srqnUAVoedjFt6wChUUimhwzeBwhp4wIiTiB+jbjjhgCNJw2W8ClSmqjGONOfS1sCiJBtYyIscVMkKLBfBL09yPCLMB4Z5wIOsTrPoio5ss5n7i9lpOkEDVuN7uuNGcuQb1gsEJyTCZb9zAGiOl+WtNMmr2jTkeKg+cuHoq/Ki+jmM3V8XXl62k+y3ZM8aBzk+kAZBEU4HB6O743Q0rkdwTj05CdUP4vnz3didH8yTgc1YAsBnoWhmOVyWyWvQIYdjZz8KXXUoOmKI1zAVr+AVIJ/G034mm6EbToyhyW/iVncmnKvuqvIPeZkdfvNVblU2T1IV8nY1glPP/fVwXSMP0sKuF0m2g5qgCK+1jDh/vtGhBREeOsc4ni8cadigtTjFxLNYVn5dkba/u2370ofu/1bKJXY9w1tOfGTw1a95/aFFOnkqbjefmuWL9i3bvI9F+QimrpNwlgrnhsFx2XwhNtW4Qrkl4PKHrxJXb6YpEmti09bQK8t0egS56/FLQgekeXpC2HXNWBpCQWbArHHUUT3f6CCnGw5ioLmEbulSbdG+plWWX7153dInkJ1VeOSGt0w9kiQ/Bfmnx3xy2zfytPws9qLTWNndSoe+YJtLY5EJSgWShiTSgDrTlDdwBjx0spMS5HRwCsX+WiXvB0UdQK3JCRdXS6a2j/8MZVi5zKN1bAwIwb6ZcUcFTyO5w++PQ4encg7HAexZnDd/8ta1i79L+3Y3rLpg9Ey0aR0G2FJd2VMXFdLxIU2IF048XSDOcq85bks3XHuBl+dFBx+K71pP+WmKawJcGaetyT/feOnyF3S0mt627c3Q+LqqsPnSGyAjZaG3ZGa899kO5ViLkKRhkB+kUzQPoEnyVNFuf2i+nE+BG69YfE2Slh+G/t+pg6FLp7lmkpllA084DWJthJlwcchnBfzAb54FkSKczwuSCr5uwedYbSc8yd6R5wOYjmgJBFCOdkvm+fOhHy6e8Un0crrhNYxUdASfJFXlc0U5/be3X7XkLlM5X/HGK/bZhFXOJ8Exz+MdBTXRNdQ0ONtpecDVdGtTP1yVIlfxbKoXH2X5UI41tO8gQx2AU7m3i89NmA8D4hIyxomtlRiu2EqQMTndcIqxer4KTiXx1kZ1zm1XLrnbpMx3zCXmZVmeh2MC7xU7IxhpCmGMTIw7Iz1Oa2A0+YYzKTGsZ7hvsPAmXyQSkywt5fNsZOR2LoQ/eOfHjSTbT3X8BpiM7AhTQcBmg1NGR2bOlcdV+zsb1y3+XgfdM6nbrly8viza36NO+RE+ci6DQUxEP808NDTCmHY47eOeizdrcH3C9840hcoPTg73atzWEc4ynCa7duMlFYzPg7nMp5W8+Qg8660OwBxJiS5o9Po0HUUDGAxnvhtOzpxw7I44zy+KqS1p2foyq++NUFStL6XF5PvhoOV8XcqOoaF9dCLa6A7GsMjaXcN5/EpLrJT+HBrxeIamlEnJh1iXok0H4OKFz4fX4wr4RjxTz0rsdah+Nt62XcXBjmPQAcXzW17Rai1IV0LDvnxrUEEOjL3oXTJLnLbSNLXKDl6+Dd1wzIewfPK6W9Yt+JXXtMejTesWPHHsmu0bcIPsk1hoBn2w1w8qnQW5RgBjo12x0jHOKrgKH2gN/PDmS4dw5uvCqjWjF8Lf6AAc08rinlvXLfmBla0+f3QkabVWldNT3BuWDSSLVuJN0QKjX+9tGg8xvUjl0jInXE7u7DJBTh2naMjGLom3JPHYKNkQKdkrybTKrsUFHi7q2EaqxMYGDJuuDuGmG04+AvllOuQyOJ0/53+G0EfYGVjGU9qktkoOuwDfeVIZjgJ4PTo5ICuS7CBMYKxhcmSTiMJmiQcu+WwBfoy64R7TWvuqeui5Fx4LI4g19kbY9y8WPYQ24mXtfXT/iKenfFMyV8w0fhiXhrvYcMz5KMfJy0DJ12eigCYPOjnYA1J8aiEKvLbP+e4Z6uYDWN6elIfg7lB5mHO2Z8p/9FzkeBbNhLNnQ0Da+MJNnuFOXoZ5Evd17r7/W2/ve3shiJ3HxA1/kxbHXbD9rPb0jqeyLD0SczImbSgwU6mLeQsN3E2n6bZ0oP17oxy534HTd26fuAOOncTBocDp7qNW5uLyfqwsfICCEWPOT3+VHnv+9p+jJw/DNxnA8Rr9waZTuYEHYyKcdW3OjOX0xLETYv4viskzceq5vqNr76d4/+i1rxpkq+YQDkx2PLyp2LTpmMZSwSodOeN/h555/Xj5yMVv8Q/UO2I5TTG3eL+p6gaUp3iddAsOPPuh14L/RTcnW2wyLG+x4RbPFkcn8zYydtPVuFLdaNVfbjHe6aqW1aYgOpD7oR/cwSEz4Z7oZiKQjd8Px6O3Khny69yDppdVwh1A6CxzuGJu5MGZcbkLfJ3VWK1YmOsMJ62Bm46XlcvrjcXbZhm+neOdzcg7suN5YtEv9JTHEKlcp1fMMPgKEguny++RECbJx/MhnAYPq8rLdIPF7NVT6IX9cCHnnEJvsRPkNcZMyoMNHJiHO3xHVwEPyEGOhLhC4S7P09B2MfZaq/Vixbt2EN49a3+DgzAP0jgNzR7G6chhOB1xEuV7dgKycrD3suUtNv01flyIeqwqqAvOIlyIZcnAYSZqb8c4DX1lleZfgCVHTttpqIwww2OLvB/UoFniHIBWLVRxsv9oR6vcf83o2hayD+K9jlN0BhnIrMgMfrHvKEScCFd+DvxgCM67sF4G26POwntV35rhUWNUbV6SJ/47XjC/d/xfW62FH+azYzZTl1TWnliLfCBGjMo3VdW5iA0MJAKOdFecDyOryTe2cCn03+4+EGnQLgPqepTrhQeqr898SJpqXznGkeZNKZyKHvLE0vFDUGvGt0mCqnlIbP2v8UNh51+1p0ZhiDUOF0iwy92co4GmCAmzvTaqPS4abt2J7yuRX8OZMT4uf5HGld/DuG+Rb8YoxAVDqOGIlvfyJEsWeZ7hynrBTBPnz3BW7IarfslL+qG8KE8nbW+GKi1Px20HPB/E9Y89D4ChtTujER7aZDODjEXDrL2hE9nYbjgreJxJfKaLvs/aE9XTqLsVV8POURZLMpkIXqbiJm7lNEDzGMkeVLI/jhtiqJadsvrCF/7EV9zj0ch5EwfC1adq6b2Za1qZp1Mt7oYLI8mHms9mxnkBin1tK32fJb8Y3pJm6WYto2Zd9aRZxRg/4VQW4+T6X8AD4Mp64pTFADNwPx57Ae7L51902J7f5nn5RdwGWa4lmDRZAQlrHvMz4uBwD2GdMPpZESHgLhu2tkfh5APrmzbT99mmTWkbTniMD0YUTGAwxluyE+7F1vBQCYWoR8MENXFf17e4wDtVeDhy8vvOHz3DSvZUTB1Zmn2EOi2EMcem+uaqjGbzZ7g1o4mTTM5OOEDDIw6+LMOB9xh9766E9VFTMhBYgZIUY2NK54pTTDc5hquY8qlAewJuSmbrVp+3/b2i7IENZWdZtg6NxxBUg6CF9zV9I23kKstNA5dNMU4K8qJhoynYV2viUTU3U2dcu+TuZeNZ2k/0UVM5gzCChLpkbdsLjyvUOFEmSspw+YCdANu5HilNl1V56/qRC7aP1HTOQ2YVZJZ5/n04e5l0mUzrCHoFpphJ6iBmPC468+TXcGY8zlhllohxJ5+Nla+L8idkuT1gYOJRXBE/qbuTRCXFe8vLF9wNFw0kxvyZAYazYjfcpqdIvn8damWryn+w+vwdZ7DqfAS3MCv/AYb9q/idUhlkehlbJ8BQJc3eCA9NVz2rDCKT9pOxrNwNVyHGGKZ6+nqo/QsiZCvgWeZ1ODCdyg9PKJgOZgIL6b64EUHyU4vjz4BbMcmsyuepVJrmG4ps8p9uv2zJ4zRjruGYi7b9aV4OfBa712ms2xn5lO10hbYh63RGuLAZcBnMBvh6pEso8jUfODzHym58IXjDxrWLZFN4ZIZTwZtwQebf5osMpDA7ymteixSZgaZIxkARcY1wk0NjGrgjdXDZ50h+OsLZ0cCpeZH+9eoLRjfgAdN3lv/mqQdvwNpPUnsFXlX/enj8sBILc9MCv7zVWZxrNjA2g2ir8hZ7kuEWswqD5RlbsL3Z5PfBedGL/zcZxVQnx5/7zMp2tuAB9Nr+6CIYhSIp8ZpMeE8cInV0iSwz6d1w0UyoN6eRJcpdFh/z5ryJr74mD2Gg4MPb7QezAl9FzzM9S0gLLE9PuTw9ORwijoIdh2Klt1ueHt5xpjD8gl5Kd7bSPDfbBAIL1Zy54B35qt7ZeLHu/D/5/VA+fPhNl6e/I4FFIRyLkZZnQ6e4UzTvyJpNUSZKRi2rJWuZXeHTMm8GBwQ+jKTpCedMWOmM+0g6kQcHLePiKJ7N8LpC95h0heubFpxuwljHZDOBEE9JxlcRMszHfMNV0W/Ui0xHOpQFWXVx3YuXS7D08ju3XrHIzzR2EPYyyjK9HqvGdGfaQdLkS+OoG05MS5mcwkDfDTyWgXbxANrGt4q43p++54N0dEUup+OlaH4+rSwn2TGyxfnC26qh7GwJYpkgTlh7aew+4BTjcVJdiHCWh+AzquNBQUbi2U+7yvOstvrPnQV5/kS16HY07CGOJhlFvGYAhPn2BFx54q4sJZ86d8Ipy3DEDODILy7ntyT1wMn3LOdkcOVsxlbAOMpEyYCHadSongQ89BPFmHHGD8pZiGC46VBMI+3GnKPRHC5FoW+3Tw1t8qiiWgfw+/m4R/9tXqm5NlAiayOyn5REOMWwTJAKiSAArOHMMBD39W2kCjOcHJaTT4yxl6vBYDhgp9TzIt2kmAxzIiEF8Ew88+IyEeFWzrgbLgGeTwptDDodrmyE89kH/pjEt5t/o6DWAZTVTtrXY6nIk+4DpZLuDJYxpqgfLiLqMI75DZwiFICTa3yD1XDWwU+dwAKfFxfZ0ECWqcmOEmVrOCn268aXiEiOcT1EsTLBcAHEaBdCD5y+xPT5ZLts660YR3bbnTrAf8/gG1zd5SRGwmvamzgFxpYy7zlzxlnXB4kwOQZaGXArip3A4n44uVYOk5XkRj8raOJep4nu0FyB5RVbxpE1/STJ1bP+VkQyWH4bK5Z/qQsi8yllan5XouPrgNMOZKxBylqmC87ybnzh2FBv0G2JGCPR45xmjCJ7WIZQw0FgmQWbmtAmHbdUP5IDgfzn5PbATb7qauP4TFoWcz9G/y/ToeF/M9VxvNMewMJbv7bkWcjGMutwnebrWAsgPUq6jNPKwRVmDJG64RTXDafQDu6VIjIcqU6ygxPT8QExqysgUcOZYfCEkEWCjvT1bUdSZXJMrvEp1HDFEkqix11SHKjiuT/e1rz01q+lzxozjrt2AAntJYs24BsHd2Y5F5FGIW5gBNto06ihYcbzI03ZgDPhOEYLgCzvVK/hIO/Md4ydt17HTgXAOyPEOU0ch0u+KZHtEd9w1wN1OZJBAn6QT+30HX3YXrxog4q7bHp2wKaL0wm8iM4vovNmveSq9ZRsBphA6iXeGT7I0BCPq5AZBo8TC8OZGH8SDg5j8j2uPGGPxTKMG+r6qohcfZMpwG1MvKeEEsPjmIVxniZYIK5AO5kggB/+86xHvkuKz9CXonXZ9OwAcm+5fMldWMW7zn03n4gp8mlGMiLGBQBn3AdnXQXwyDW+wWqIx8OIpUzjIqlOswrygIqF+KxsIMCqxPSzjMcRhTIlPB74JPhgVYN84LIdsfGhjK9ApWVxVb/vxVFi3w4gYTifuAR/weNefa49OImaaAmCDPFpM96VYLureBDgEyangavjjBLbA8yqxM4hlbj9mIf9ohpmfE8LXJFYIeK7rNtaOWL6Cveu7l3Y2vG1mNItLfd1K4ixVeePvRWjDSuYKzy7xYMThqgPahk2CEY4wRFpF3DpUcPqcpzHIiOcMu8Z1XKbGh7JiKqape5AjIJAQ0L1YQBt6IY7LW7L6RHToPtEWfocnLBq45XDeBegf5hxD2B1CsKdjHNxRMfrnawCZXKMS3YsdJfgYcYIljdxSmWLmri11OFkuWA4NHWSKPIZRna2QrEK3saAk8TgCSGLBI8fntfZAYiBbvWZVohwlUc4JhT5qJo+bzbOZ81ZdQCJt6xdvAHHg8s0FRGwhijNLKxB2162Z0EYdfQNZojLN1659Dpzy0zxrDuAgrZuf+wLVTG5IRtchFwYEq4vNBoizPWGpxG3oalecvXDcCbGn9U3fgNXMTDJZkzAczUAiCH4yPFQbruk4b6K0+mqaGt4zXaUNHGrQlzKsMwbt5pxi3zD1tHhz1vxbOI5dQDf5WrvGD8bV3Y/5MeRFIIRDXXBubPAye3GnwkPjvUeEj/W1wNXR6M3mvwmbh1mA8P4hrNnkOafMsEirxvbO0bPnulzOrF1TAdRzYJ++ePPe2F5kQ/iT5i0jtMzZLZTgeJCxklXdq64F2dRo3pQxURTvrWoL86KXigiUs3HLLEiTv/9cYx8zAZ4xnvzRGvByXdekm5V/TlszNw5VHHUoz/9/L5D7cFr82zwA+GP+LDIt8uxokyUrJH64RRiB0Hr2MBngkGerol0uN/W+BE3VPVyYk9b56nI14n5vopGfjF1Y7uYPH1X/0j0nKaguGF3XrJsa7F44UfwBOo6Pum3syN94M4b6McWqvGsBmDACTHTxNHYGJdCOiDCKURyPO6FSj75QYdLdHDyGYCrqifS8fzRPkZxhxvPYtVnhgfchZzz17f3WfjRXXW+t0ZSd3nDP+S29YCxf8LThovw0BCfRLPrBDYIxtKhtFnB8hZ72Bxgjja+cHDoKzmGBcjEfBU6FehOL5CRKgHhedkc8T563Xk+FpVXxWX7bh7+3Iv6h9yi1iarzh89DU/Nr4SB++kbbWw/Q2i7c4gb4QBj3LgE54KzgxUggE7zThekot3ETbyXy6814vkzvuZV4E8ZLr7W6d69bWj67olxtY/5xPNvw2qQf8YToKP04FwOtVZQlU9rr5hHXK3AxjokUuX2QNPrTejFb+LeKbyxpimnLO5uV+1PvCT/mKe3NXnXx57ZZ+HyxZ+CN9bgqnCB1uCrsOEEYbGnTEIz7sHp2Ymob30b7xE1MfK0I0IOVleIGTQbF2V8mx8jHn/OtrpyPB2/ZHf+bGGQHyXMkgian+T71mx/D74U+xX88Z/38LO9/Ir47BwTdRRNiQ+KzJtzgssifnA8iT7U+BGXxcp6F2gK83WA60NL/JZFVfwI/fP529Yu/JEvnddoj3UAreRf4SgGJ0/Hh4zwJ80HDuRHrLWgis7zjqEPOn9OShk5pieuqiglQcEJCgdbL9cU9MKtvNOPviIeoPN5OOx8Ismzy9t/ePq6/5d/0tzcw3hkzbYVWHH3MdzQ+3scpN/IMyV2Rn3Olmc7GCuaM2vTjeHGJ9H3RuB3IJZ25PTCO6vucFH16yrLvzk18dw1P/76ymdUfw9uaPJeCyNrqhV5OvoRfCzpDCh9q1YLtLnkE2tRFRojO1jXA7eDLj28C2dBPKXkd3/wvhy0pw/gomj9jsni+uY3/r1xeyQKTdwj0nsI5R+1Wdxafgz+/vNJGL2r8HrUSoxBzLeYongdIcfSNBvZSMfObuJqRcSJqtbPgnBNwMW+WqWGU/my/TReTtwI8Puj7Wduv2fdAZ33lnrYPt+wTJ9voXORd/y5YyvbrfK9OGCfgG8WHY1zktdhNbReWNNUxeXcXGjLXxxq01Lk8dAi3pt3P5xDahbCGRm+zpJi0Vl2J57Y/kc6WN1x81fdR7Rj0XszHczdm0p76eIficaH6A/Gh+2OwO3FI7BnvIlfdMQoXYYpYgiO056A00J0Cqcl7iH4oTOcs9lvcK3+5lmF91+r5/GBzs2Q8RguEu9L2u37iqR4dHduHfSyfVfxl1QHNBvB72omY2Mrsun01VVWvAbT1EF5lhyGz4HhzfryAHh6KbzP/y+g7mZcLj2MVz4faqX540WZPFUOVL9Nhoe3YFWCvz/S1PDi5/8PdwJRfwHK1rAAAAAASUVORK5CYII=",
	noir: "data:image/png;base64,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"
};
function Dd(e) {
	return v.find((t) => t.id === e)?.name ?? e;
}
var Od = class {
	adapter;
	projectKey;
	config = null;
	state = {
		status: "idle",
		address: null,
		walletId: null,
		walletName: null,
		network: "testnet",
		error: null
	};
	listeners = /* @__PURE__ */ new Set();
	fetchConfig;
	unsubscribeAdapter = null;
	initializePromise = null;
	appearanceOverrides;
	constructor(e) {
		this.projectKey = e.projectKey, this.appearanceOverrides = e.appearance, this.adapter = e.adapter ?? new Td();
		let t = (e.apiBaseUrl ?? "https://wallets.velo.dev").replace(/\/$/, "");
		this.fetchConfig = e.fetchConfig ?? (async () => {
			let e = await fetch(`${t}/api/v1/wallet-config/${encodeURIComponent(this.projectKey)}`);
			if (!e.ok) throw new h({
				403: "ORIGIN_NOT_ALLOWED",
				404: "CONFIG_NOT_FOUND",
				409: "CONFIG_INCOMPATIBLE",
				410: "CONFIG_DISABLED"
			}[e.status] ?? "RUNTIME_INIT_FAILED", `Wallet configuration request failed (${e.status}).`);
			return await e.json();
		});
	}
	initialize() {
		return this.initializePromise ||= this.initializeOnce(), this.initializePromise;
	}
	async initializeOnce() {
		this.patchState({
			status: "loading",
			error: null
		});
		try {
			let e = R(await this.fetchConfig());
			this.config = {
				...e,
				appearance: j(e.appearance, this.appearanceOverrides)
			};
			let t = F(this.config.appearance);
			if (t.length > 0) throw new h("CONFIG_INCOMPATIBLE", `Invalid appearance override: ${t.join(" ")}`);
			this.patchState({ network: this.config.network }), await this.adapter.initialize(this.config), this.unsubscribeAdapter = this.adapter.subscribe((e) => {
				if (e.type === "disconnected") {
					this.clearSession(), this.patchState({
						status: "disconnected",
						address: null,
						walletId: null,
						walletName: null,
						error: null
					});
					return;
				}
				if (e.networkPassphrase && e.networkPassphrase !== wd(this.requireConfig())) {
					this.patchState({
						status: "error",
						error: new h("NETWORK_MISMATCH", `Switch the wallet to ${this.config?.network === "public" ? "Mainnet" : "Testnet"}.`)
					});
					return;
				}
				this.patchState({
					...e.address === null ? {} : {
						address: e.address,
						status: "connected"
					},
					...e.walletId === null ? {} : {
						walletId: e.walletId,
						walletName: Dd(e.walletId)
					}
				});
			});
			let n = this.readSession();
			if (n && this.adapter.restoreSession) {
				let e = await this.adapter.restoreSession(n);
				if (e) {
					this.patchState({
						status: "connected",
						address: e.address,
						walletId: e.walletId,
						walletName: Dd(e.walletId)
					});
					return;
				}
				this.clearSession(), this.patchState({
					status: "ready",
					error: new h("SESSION_STALE", "The saved wallet session expired. Connect again to continue.")
				});
				return;
			}
			this.patchState({
				status: "ready",
				error: null
			});
		} catch (e) {
			throw this.patchState({
				status: "error",
				error: _(e, "RUNTIME_INIT_FAILED")
			}), this.state.error;
		}
	}
	async listWallets() {
		await this.initialize();
		let e = this.requireConfig(), t = this.adapter.listWallets ? await this.adapter.listWallets() : e.walletIds.map((e) => ({
			id: e,
			name: Dd(e) ?? e,
			isAvailable: !0,
			url: ""
		})), n = new Map(t.map((e) => [e.id, e]));
		return e.walletIds.map((e) => {
			let t = n.get(e), r = v.find((t) => t.id === e), i = kd(t?.url);
			return {
				id: e,
				name: r?.name ?? t?.name ?? e,
				logo: Ed[e] ?? "",
				isAvailable: t?.isAvailable ?? !1,
				installUrl: i
			};
		}).filter((t) => !e.modal.hideUnsupportedWallets || t.isAvailable);
	}
	async connect(e) {
		await this.initialize(), this.patchState({
			status: "connecting",
			error: null
		});
		try {
			let t = await this.adapter.connect(e);
			return this.patchState({
				status: "connected",
				address: t.address,
				walletId: t.walletId,
				walletName: Dd(t.walletId)
			}), this.writeSession(t), t.address;
		} catch (e) {
			let t = _(e, "WALLET_UNAVAILABLE");
			throw this.patchState({
				status: "error",
				error: t
			}), t;
		}
	}
	async disconnect() {
		await this.adapter.disconnect(), this.clearSession(), this.patchState({
			status: "disconnected",
			address: null,
			walletId: null,
			walletName: null,
			error: null
		});
	}
	getAddress() {
		return this.state.address;
	}
	getConfig() {
		return this.config;
	}
	signTransaction(e) {
		return this.sign((t) => this.adapter.signTransaction(e, t));
	}
	signAuthEntry(e) {
		return this.sign((t) => this.adapter.signAuthEntry(e, t));
	}
	signMessage(e) {
		return this.sign((t) => this.adapter.signMessage(e, t));
	}
	getState = () => this.state;
	subscribe = (e) => (this.listeners.add(e), () => this.listeners.delete(e));
	destroy() {
		this.unsubscribeAdapter?.(), this.unsubscribeAdapter = null, this.adapter.destroy?.(), this.listeners.clear();
	}
	async sign(e) {
		let t = this.state.address;
		if (!t) throw new h("SESSION_STALE", "Connect a wallet before signing.");
		try {
			return await e(t);
		} catch (e) {
			throw _(e, "SIGNING_FAILED");
		}
	}
	requireConfig() {
		if (!this.config) throw new h("RUNTIME_INIT_FAILED", "Runtime is not initialized.");
		return this.config;
	}
	patchState(e) {
		this.state = {
			...this.state,
			...e
		}, this.listeners.forEach((e) => e());
	}
	storageKey() {
		return `velo-wallets:v1:${this.projectKey}:session`;
	}
	readSession() {
		if (typeof window > "u" || !this.config?.session.persist) return null;
		try {
			let e = window.localStorage.getItem(this.storageKey());
			if (!e) return null;
			let t = JSON.parse(e);
			return typeof t.address == "string" ? {
				address: t.address,
				walletId: typeof t.walletId == "string" ? t.walletId : null
			} : null;
		} catch {
			return null;
		}
	}
	writeSession(e) {
		typeof window > "u" || !this.config?.session.persist || window.localStorage.setItem(this.storageKey(), JSON.stringify(e));
	}
	clearSession() {
		typeof window < "u" && window.localStorage.removeItem(this.storageKey());
	}
};
function kd(e) {
	if (!e) return null;
	try {
		let t = new URL(e);
		return t.protocol === "https:" ? t.href : null;
	} catch {
		return null;
	}
}
var Ad = null, jd = "", Md = 0;
function Nd(e) {
	if (Ad && Ad.projectKey !== e.projectKey) throw new h("RUNTIME_INIT_FAILED", "Only one Velo Wallets project key can be active in a document.");
	let t = JSON.stringify(e.appearance ?? {});
	if (Ad && jd !== t) throw new h("RUNTIME_INIT_FAILED", "Only one Velo Wallets appearance override can be active in a document.");
	return Ad ||= (jd = t, new Od(e)), Md += 1, Ad;
}
function Pd(e) {
	Ad === e && (Md = Math.max(0, Md - 1), Md === 0 && (Ad.destroy(), Ad = null, jd = ""));
}
//#endregion
//#region src/wallet-selector.ts
var Fd = "\n  .velo-selector { width: min(900px, calc(100vw - 32px)); max-width: none; max-height: min(720px, calc(100dvh - 32px)); padding: 0; overflow: hidden; border: 1px solid var(--velo-wallet-border); border-radius: var(--velo-wallet-modal-radius); background: var(--velo-wallet-background); color: var(--velo-wallet-text); box-shadow: var(--velo-wallet-shadow); font: 400 16px/1.45 var(--velo-wallet-font-family); }\n  .velo-selector::backdrop { background: rgb(12 15 23 / .58); backdrop-filter: blur(3px); }\n  .velo-selector * { box-sizing: border-box; }\n  .velo-selector__shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 480px; max-height: min(720px, calc(100dvh - 32px)); }\n  .velo-selector__header, .velo-selector__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; }\n  .velo-selector__header { border-bottom: 1px solid var(--velo-wallet-border); }\n  .velo-selector__header h2 { margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: -.02em; }\n  .velo-selector__header p, .velo-selector__footer { margin: 3px 0 0; color: var(--velo-wallet-muted-text); font-size: .8rem; }\n  .velo-selector__close { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 1px solid var(--velo-wallet-border); border-radius: 999px; background: var(--velo-wallet-surface); color: var(--velo-wallet-text); font: inherit; font-size: 1.4rem; cursor: pointer; }\n  .velo-selector__content { display: grid; min-height: 0; grid-template-columns: minmax(250px, 36%) minmax(0, 1fr); }\n  .velo-selector__wallets { min-height: 0; overflow: auto; border-right: 1px solid var(--velo-wallet-border); padding: 18px 16px; }\n  .velo-selector__eyebrow { margin: 0 8px 10px; color: var(--velo-wallet-muted-text); font-size: .76rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }\n  .velo-selector__list { display: grid; gap: 5px; }\n  .velo-selector__row { display: flex; align-items: center; gap: 11px; min-height: 64px; padding: 8px; border: 1px solid transparent; border-radius: calc(var(--velo-wallet-modal-radius) * .75); }\n  .velo-selector__row:hover, .velo-selector__row:focus-within { border-color: var(--velo-wallet-border); background: var(--velo-wallet-surface); }\n  .velo-selector__pick { display: flex; min-width: 0; flex: 1; align-items: center; gap: 11px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }\n  .velo-selector__pick:disabled { cursor: wait; }\n  .velo-selector__icon { display: grid; width: 44px; height: 44px; flex: 0 0 auto; place-items: center; overflow: hidden; border: 1px solid var(--velo-wallet-border); border-radius: 13px; background: #fff; }\n  .velo-selector__icon img { display: block; width: 100%; height: 100%; object-fit: contain; }\n  .velo-selector__name { display: block; overflow: hidden; font-size: .95rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }\n  .velo-selector__availability { display: block; margin-top: 2px; color: var(--velo-wallet-muted-text); font-size: .75rem; }\n  .velo-selector__install { flex: 0 0 auto; color: var(--velo-wallet-accent); font-size: .78rem; font-weight: 650; text-decoration: none; }\n  .velo-selector__install:hover { text-decoration: underline; }\n  .velo-selector__details { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; padding: 32px clamp(24px, 5vw, 64px); text-align: center; }\n  .velo-selector__detail-mark { display: grid; width: 60px; height: 60px; place-items: center; margin-bottom: 14px; border: 1px solid var(--velo-wallet-border); border-radius: 18px; background: var(--velo-wallet-surface); color: var(--velo-wallet-accent); font-size: 1.5rem; }\n  .velo-selector__details h3 { margin: 0; font-size: 1.3rem; font-weight: 700; letter-spacing: -.02em; }\n  .velo-selector__details p { max-width: 360px; margin: 9px 0 0; color: var(--velo-wallet-muted-text); font-size: .92rem; }\n  .velo-selector__hint { margin-top: 26px !important; padding: 12px 14px; border: 1px solid var(--velo-wallet-border); border-radius: 12px; background: var(--velo-wallet-surface); text-align: left; }\n  .velo-selector__status { min-height: 1.4em; color: var(--velo-wallet-muted-text); font-size: .8rem !important; }\n  .velo-selector__status[data-kind=\"error\"] { color: var(--velo-wallet-danger); }\n  .velo-selector__footer { border-top: 1px solid var(--velo-wallet-border); }\n  .velo-selector button:focus-visible, .velo-selector a:focus-visible { outline: 3px solid var(--velo-wallet-focus-ring); outline-offset: 3px; }\n  .velo-selector__empty { padding: 12px 8px; color: var(--velo-wallet-muted-text); font-size: .9rem; }\n  @media (max-width: 620px) {\n    .velo-selector { width: min(460px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); }\n    .velo-selector__shell { min-height: min(680px, calc(100dvh - 24px)); max-height: calc(100dvh - 24px); }\n    .velo-selector__header, .velo-selector__footer { padding: 16px; }\n    .velo-selector__content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; overflow: auto; }\n    .velo-selector__wallets { max-height: 47dvh; border-right: 0; padding: 12px; }\n    .velo-selector__details { padding: 18px 20px 22px; }\n    .velo-selector__detail-mark { display: none; }\n    .velo-selector__details h3 { font-size: 1.05rem; }\n    .velo-selector__details p { margin-top: 4px; }\n    .velo-selector__hint { display: none; }\n  }\n  @media (prefers-reduced-motion: no-preference) {\n    .velo-selector__row { transition: background-color 120ms ease, border-color 120ms ease; }\n  }\n", Id = null;
function Ld(e, t) {
	let n = t.theme === "system" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches, r = d(t, n);
	Object.entries(p(t, r)).forEach(([t, n]) => e.style.setProperty(t, n)), e.style.setProperty("--velo-wallet-font-family", {
		system: "ui-sans-serif, system-ui, sans-serif",
		serif: "ui-serif, Georgia, Cambria, serif",
		mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
	}[t.fontFamily]), e.dataset.theme = n || t.theme === "dark" ? "dark" : "light";
}
function Rd(e) {
	return Id || (Id = zd(e).finally(() => {
		Id = null;
	}), Id);
}
function zd(e) {
	let t = e.getConfig(), n = t?.appearance ?? M(x), r = document.createElement("dialog");
	return r.className = "velo-selector", r.setAttribute("aria-labelledby", "velo-selector-title"), Ld(r, n), r.innerHTML = `
    <style>${Fd}</style>
    <div class="velo-selector__shell">
      <header class="velo-selector__header">
        <div><h2 id="velo-selector-title">Connect a wallet</h2><p data-network></p></div>
        <button class="velo-selector__close" type="button" aria-label="Close wallet selector">×</button>
      </header>
      <div class="velo-selector__content">
        <section class="velo-selector__wallets" aria-label="Wallet options">
          <h3 class="velo-selector__eyebrow">Choose a wallet</h3>
          <div class="velo-selector__list" role="list" aria-live="polite"></div>
        </section>
        <aside class="velo-selector__details" aria-live="polite" aria-atomic="true">
          <span class="velo-selector__detail-mark" aria-hidden="true">✦</span>
          <h3 data-detail-title>Your Stellar wallet</h3>
          <p data-detail-message>Connect securely with a wallet enabled by this app.</p>
          <p class="velo-selector__hint">Your wallet keeps control of your keys. Velo requests permission only to access your public address.</p>
          <p class="velo-selector__status" role="status" data-status>Loading available wallets…</p>
          <button type="button" data-retry hidden>Try again</button>
        </aside>
      </div>
      <footer class="velo-selector__footer"><span>Velo Wallets</span><span data-network-footer></span></footer>
    </div>
  `, new Promise((n) => {
		let i = !1, a = !1, o = t, s = null, c = r.querySelector(".velo-selector__list"), l = r.querySelector("[data-detail-title]"), u = r.querySelector("[data-detail-message]"), d = r.querySelector("[data-status]"), f = r.querySelector("[data-retry]"), p = t?.network === "public" ? "Stellar Mainnet" : "Stellar Testnet";
		r.querySelector("[data-network]").textContent = p, r.querySelector("[data-network-footer]").textContent = p;
		function m(e) {
			i || (i = !0, r.close(), r.remove(), n(e));
		}
		function h(e) {
			if (c.replaceChildren(), e.length === 0) {
				let e = document.createElement("p");
				e.className = "velo-selector__empty", e.textContent = "No available wallets are enabled for this app.", c.append(e);
				return;
			}
			e.forEach((e) => {
				let t = document.createElement("div");
				t.className = "velo-selector__row", t.setAttribute("role", "listitem");
				let n = document.createElement("button");
				n.className = "velo-selector__pick", n.type = "button", n.disabled = !e.isAvailable || a, n.setAttribute("aria-label", `${e.name}${e.isAvailable ? ", available" : ", unavailable"}`);
				let r = document.createElement("span");
				if (r.className = "velo-selector__icon", e.logo) {
					let t = document.createElement("img");
					t.src = e.logo, t.alt = "", t.width = 44, t.height = 44, r.append(t);
				} else r.textContent = e.name.slice(0, 1).toUpperCase();
				let i = document.createElement("span");
				i.className = "velo-selector__name", i.textContent = e.name;
				let l = document.createElement("span");
				l.className = "velo-selector__availability", l.textContent = a && s?.id === e.id ? "Opening wallet…" : e.isAvailable ? "Available" : "Not detected";
				let u = document.createElement("span");
				if (u.append(i, l), n.append(r, u), n.addEventListener("click", () => void g(e)), t.append(n), !e.isAvailable && o?.modal.showInstallLabel && e.installUrl) {
					let n = document.createElement("a");
					n.className = "velo-selector__install", n.href = e.installUrl, n.target = "_blank", n.rel = "noopener noreferrer", n.textContent = "Install", n.setAttribute("aria-label", `Install ${e.name} (opens in a new tab)`), t.append(n);
				}
				c.append(t);
			});
		}
		async function g(t) {
			if (!(a || !t.isAvailable)) {
				a = !0, s = t, f.hidden = !0, l.textContent = `Opening ${t.name}`, u.textContent = "Approve the connection request in your wallet.", d.textContent = `Waiting for ${t.name}…`, d.dataset.kind = "pending", h(_);
				try {
					await e.connect(t.id), m(t.id);
				} catch (e) {
					a = !1, l.textContent = "Connection didn’t complete", u.textContent = e instanceof Error ? e.message : "The wallet could not connect. Choose it to try again.", d.textContent = "Choose a wallet to try again.", d.dataset.kind = "error", h(_);
				}
			}
		}
		let _ = [];
		async function v() {
			f.hidden = !0, delete d.dataset.kind, d.textContent = "Loading available wallets…", l.textContent = "Your Stellar wallet", u.textContent = "Connect securely with a wallet enabled by this app.";
			try {
				_ = await e.listWallets(), o = e.getConfig() ?? o, o?.appearance && Ld(r, o.appearance);
				let t = o?.network === "public" ? "Stellar Mainnet" : "Stellar Testnet";
				r.querySelector("[data-network]").textContent = t, r.querySelector("[data-network-footer]").textContent = t, h(_), d.textContent = _.length ? "Choose a wallet to continue." : "No wallet is currently available.";
			} catch (e) {
				c.replaceChildren();
				let t = document.createElement("p");
				t.className = "velo-selector__empty", t.textContent = "Wallet options could not be loaded.", c.append(t), l.textContent = "Couldn’t load wallets", u.textContent = e instanceof Error ? e.message : "Try loading the wallet list again.", d.textContent = "Check your connection, then retry.", d.dataset.kind = "error", f.hidden = !1;
			}
		}
		r.querySelector(".velo-selector__close").addEventListener("click", () => m(null)), f.addEventListener("click", () => void v()), r.addEventListener("cancel", (e) => {
			e.preventDefault(), m(null);
		}), r.addEventListener("close", () => m(null)), document.body.append(r), r.showModal(), v();
	});
}
//#endregion
//#region src/element.ts
var Bd = 1, Vd = typeof HTMLElement > "u" ? class {} : HTMLElement, Hd = class extends Vd {
	client = null;
	unsubscribe = null;
	root = null;
	lastStatus = "idle";
	localAppearance;
	themeMedia = null;
	handleThemeChange = () => this.render();
	set appearance(e) {
		this.localAppearance = e;
	}
	get appearance() {
		return this.localAppearance;
	}
	connectedCallback() {
		this.root ||= this.attachShadow({ mode: "open" });
		let e = this.getAttribute("project-key");
		if (!e) {
			this.renderError("Add a project-key attribute to initialize Velo Wallets.");
			return;
		}
		let t = Jd(this);
		this.client = Nd({
			projectKey: e,
			apiBaseUrl: this.getAttribute("api-base") ?? void 0,
			appearance: Yd(t, this.localAppearance)
		}), window.matchMedia && (this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)"), this.themeMedia.addEventListener("change", this.handleThemeChange)), this.unsubscribe = this.client.subscribe(() => this.render()), this.render(), this.client.initialize().then(() => this.dispatch("velo:wallet-ready")).catch((e) => this.dispatch("velo:wallet-error", { error: e }));
	}
	disconnectedCallback() {
		this.unsubscribe?.(), this.unsubscribe = null, this.client && Pd(this.client), this.client = null, this.themeMedia?.removeEventListener("change", this.handleThemeChange), this.themeMedia = null;
	}
	async connect() {
		if (!this.client) throw Error("Velo Wallets element is not connected.");
		try {
			return await this.client.connect();
		} finally {
			this.root?.querySelector(".primary")?.focus();
		}
	}
	async disconnect() {
		this.client && (await this.client.disconnect(), this.root?.querySelector(".primary")?.focus());
	}
	getAddress() {
		return Promise.resolve(this.client?.getAddress() ?? null);
	}
	signTransaction(e) {
		if (!this.client) throw Error("Velo Wallets element is not connected.");
		return this.announceSigning("transaction", () => this.client.signTransaction(e));
	}
	signAuthEntry(e) {
		if (!this.client) throw Error("Velo Wallets element is not connected.");
		return this.announceSigning("authorization entry", () => this.client.signAuthEntry(e));
	}
	signMessage(e) {
		if (!this.client) throw Error("Velo Wallets element is not connected.");
		return this.announceSigning("message", () => this.client.signMessage(e));
	}
	render() {
		if (!this.root || !this.client) return;
		let e = this.client.getState(), t = e.status === "connected", n = this.client.getConfig()?.appearance ?? M(x), r = n.theme, i = d(n, r === "system" && !!this.themeMedia?.matches), a = Object.fromEntries(Object.entries(p(n, i)).map(([e, t]) => [e.replace("--velo-wallet-", "--velo-config-"), t])), o = t ? `${e.walletName ?? "Wallet"} · ${Wd(e.address)}` : e.status === "connecting" ? "Connecting…" : e.status === "loading" ? "Loading…" : n.buttonLabel;
		this.root.innerHTML = `
      <style>${Xd}</style>
      <div class="wallet theme-${r}" part="container" data-status="${e.status}" style="${Kd(m(a))}">
        <button class="primary" part="trigger" type="button" ${e.status === "connecting" || e.status === "loading" ? "disabled" : ""}>${Gd(o)}</button>
        ${t ? "<div class=\"actions\" part=\"actions\"><button class=\"copy\" part=\"copy-button\" type=\"button\">Copy address</button><button class=\"disconnect\" part=\"disconnect-button\" type=\"button\">Disconnect</button></div>" : ""}
        <span class="status" part="status" role="status" aria-live="polite">${Gd(Ud(e))}</span>
      </div>
    `, this.root.querySelector(".primary")?.addEventListener("click", () => {
			(t ? Promise.resolve() : Rd(this.client).then(() => {
				this.root?.querySelector(".primary")?.focus();
			})).catch((e) => this.dispatch("velo:wallet-error", { error: e }));
		}), this.root.querySelector(".disconnect")?.addEventListener("click", () => {
			this.disconnect().catch((e) => this.dispatch("velo:wallet-error", { error: e }));
		}), this.root.querySelector(".copy")?.addEventListener("click", () => {
			let t = e.address;
			t && navigator.clipboard && navigator.clipboard.writeText(t).then(() => this.setAnnouncement("Address copied."));
		}), this.dispatch("velo:wallet-changed", { state: e }), e.status === "connected" && this.lastStatus !== "connected" && this.dispatch("velo:wallet-connected", { address: e.address }), e.status === "disconnected" && this.lastStatus === "connected" && this.dispatch("velo:wallet-disconnected"), this.lastStatus = e.status;
	}
	renderError(e) {
		this.root && (this.root.innerHTML = `<span role="alert">${Gd(e)}</span>`);
	}
	async announceSigning(e, t) {
		this.setAnnouncement(`Requesting ${e} signature.`);
		try {
			let n = await t();
			return this.setAnnouncement(`${e[0]?.toUpperCase()}${e.slice(1)} signed.`), n;
		} catch (t) {
			throw this.setAnnouncement(`${e[0]?.toUpperCase()}${e.slice(1)} signing failed.`), this.dispatch("velo:wallet-error", { error: t }), t;
		}
	}
	setAnnouncement(e) {
		let t = this.root?.querySelector(".status");
		t && (t.textContent = e);
	}
	dispatch(e, t = {}) {
		this.dispatchEvent(new CustomEvent(e, {
			bubbles: !0,
			composed: !0,
			detail: {
				version: Bd,
				...t
			}
		}));
	}
};
function Ud(e) {
	return e.error ? e.error.message : e.status === "connected" ? `Connected to ${e.walletName ?? "wallet"}.` : e.status === "connecting" ? "Opening wallet selector." : e.status === "loading" ? "Loading wallet configuration." : e.status === "ready" ? "Wallet connection is ready." : e.status === "disconnected" ? "Wallet disconnected." : "";
}
function Wd(e) {
	return e && e.length > 14 ? `${e.slice(0, 7)}…${e.slice(-5)}` : e ?? "";
}
function Gd(e) {
	return e.replace(/[&<>'"]/g, (e) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"'": "&#39;",
		"\"": "&quot;"
	})[e] ?? e);
}
function Kd(e) {
	return Gd(e).replace(/`/g, "&#96;");
}
var qd = [
	["background", "background"],
	["surface", "surface"],
	["surfaceMuted", "surface-muted"],
	["text", "text"],
	["mutedText", "muted-text"],
	["accent", "accent"],
	["accentText", "accent-text"],
	["border", "border"],
	["danger", "danger"],
	["focusRing", "focus-ring"]
];
function Jd(e) {
	let t = getComputedStyle(e), n = {}, r = {};
	for (let [e, i] of qd) {
		let a = t.getPropertyValue(`--velo-wallet-${i}`).trim(), o = t.getPropertyValue(`--velo-wallet-light-${i}`).trim() || a, s = t.getPropertyValue(`--velo-wallet-dark-${i}`).trim() || a;
		o && (n[e] = o), s && (r[e] = s);
	}
	return Object.keys(n).length || Object.keys(r).length ? { palettes: {
		light: n,
		dark: r
	} } : void 0;
}
function Yd(e, t) {
	return e ? t ? {
		...e,
		...t,
		palettes: {
			light: {
				...e.palettes?.light,
				...t.palettes?.light
			},
			dark: {
				...e.palettes?.dark,
				...t.palettes?.dark
			}
		},
		button: {
			...e.button,
			...t.button
		},
		modal: {
			...e.modal,
			...t.modal
		}
	} : e : t;
}
var Xd = "\n  :host { display: inline-block; }\n  .wallet { display: grid; gap: .35rem; }\n  button { border: 1px solid var(--velo-wallet-border, var(--velo-config-border)); border-radius: var(--velo-wallet-button-radius, var(--velo-config-button-radius)); background: var(--velo-wallet-surface, var(--velo-config-surface)); color: var(--velo-wallet-text, var(--velo-config-text)); cursor: pointer; font-family: var(--velo-wallet-font-family, var(--velo-config-font-family)); font-size: .875rem; font-weight: 600; padding: .45rem .7rem; }\n  button.primary { background: var(--velo-wallet-button-background, var(--velo-config-button-background)); border-color: var(--velo-wallet-button-border, var(--velo-config-button-border)); color: var(--velo-wallet-button-text, var(--velo-config-button-text)); padding: var(--velo-wallet-button-padding, var(--velo-config-button-padding)); }\n  .actions { display: flex; gap: .4rem; }\n  button.disconnect { color: var(--velo-wallet-danger, var(--velo-config-danger)); }\n  button:focus-visible { outline: 3px solid var(--velo-wallet-focus-ring, var(--velo-config-focus-ring)); outline-offset: 2px; }\n  button:disabled { cursor: wait; opacity: .65; }\n  .status { color: var(--velo-wallet-muted-text, var(--velo-config-muted-text)); font-family: var(--velo-wallet-font-family, var(--velo-config-font-family)); font-size: .75rem; max-width: 24rem; }\n  [data-status=\"error\"] .status { color: var(--velo-wallet-danger, var(--velo-config-danger)); }\n";
typeof customElements < "u" && !customElements.get("velo-wallet") && customElements.define("velo-wallet", Hd);
//#endregion
export { Hd as VeloWalletElement };

//# sourceMappingURL=velo-wallet.js.map