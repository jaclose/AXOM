//#region \0rolldown/runtime.js
var e = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), t = {
	daily_learning: {
		label: "Daily learning",
		group: "Study",
		description: "A small next step from your current course."
	},
	daily_games: {
		label: "Daily Games",
		group: "Study",
		description: "Only the games you have enabled."
	},
	weekly_report: {
		label: "Weekly Report",
		group: "Study",
		description: "Your recorded effort, progress and next opportunity."
	},
	monthly_report: {
		label: "Monthly Report",
		group: "Study",
		description: "A longer view of your learning."
	},
	exam_reminders: {
		label: "Exam reminders",
		group: "Study",
		description: "Upcoming assessments, without readiness promises."
	},
	annual_pulse: {
		label: "AXOM Pulse",
		group: "Study",
		description: "Your year in medicine, measured."
	},
	essays_from_jafar: {
		label: "Essays & Notes from Jafar",
		group: "Editorial",
		description: "Medicine, attention and the work of learning."
	},
	product_updates: {
		label: "Product updates",
		group: "AXOM",
		description: "Meaningful additions to your workspace."
	},
	research_news: {
		label: "Research & News",
		group: "AXOM",
		description: "Selected research and academic news."
	},
	marketing: {
		label: "Offers & announcements",
		group: "AXOM",
		description: "Occasional optional announcements."
	}
}, n = {
	welcome: "account",
	auth: "auth",
	security: "security",
	daily_learning: "daily_learning",
	daily_games: "daily_games",
	weekly_report: "weekly_report",
	monthly_report: "monthly_report",
	exam_reminder: "exam_reminders",
	inactivity: "daily_learning",
	essay: "essays_from_jafar",
	product_update: "product_updates",
	research: "research_news",
	marketing: "marketing",
	pulse: "annual_pulse",
	export_requested: "data_export",
	export_ready: "data_export",
	deletion_requested: "account_deletion",
	deletion_scheduled: "account_deletion",
	deletion_cancelled: "account_deletion",
	deletion_completed: "account_deletion"
};
function r(e) {
	return Object.hasOwn(t, e);
}
function i(e = "UTC") {
	return Object.keys(t).map((t) => ({
		category: t,
		enabled: !1,
		time: t === "daily_games" ? "18:00" : "08:00",
		weekday: 0,
		timezone: e
	}));
}
function a(e) {
	try {
		return new Intl.DateTimeFormat("en", { timeZone: e }).format(), !0;
	} catch {
		return !1;
	}
}
function o(e) {
	if (!Object.hasOwn(t, e.category) || typeof e.enabled != "boolean" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) || !Number.isInteger(e.weekday) || e.weekday < 0 || e.weekday > 6 || !a(e.timezone)) throw Error("Choose a valid category, local time, weekday and timezone.");
}
function s(e) {
	return /^#[0-9a-f]{6}$/i.test(e) ? e : "#c8a96a";
}
function c(e, t = "https://axom.info") {
	try {
		let n = new URL(e);
		return n.protocol === "https:" || n.protocol === "http:" && ["localhost", "127.0.0.1"].includes(n.hostname) ? n.href : t;
	} catch {
		return t;
	}
}
function l(e) {
	return e.trim().split(/\s+/)[0] || "there";
}
function u(e, t) {
	let n = {
		firstName: l(t.displayName),
		displayName: t.displayName || "Learner",
		currentCourse: t.course || "your course",
		examName: t.exam?.name || "your assessment",
		daysUntilExam: t.exam ? String(t.exam.days) : ""
	};
	return e.replace(/\{\{\s*(\w+)\s*\}\}/g, (e, t) => {
		if (!Object.hasOwn(n, t)) throw Error(`Unsupported template variable: ${t}`);
		return n[t];
	});
}
function d(e, t) {
	return t.addressValid ? !t.verified && e !== "auth" ? "unverified-address" : t.suppressed ? "address-suppressed" : r(e) && t.deletionPending ? "deletion-pending" : r(e) && !t.preference?.enabled ? "not-subscribed" : null : "invalid-address";
}
function f(e, t) {
	let n = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
		timeZone: t,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		weekday: "short"
	}).formatToParts(e).map((e) => [e.type, e.value]));
	return {
		day: `${n.year}-${n.month}-${n.day}`,
		time: `${n.hour}:${n.minute}`,
		weekday: [
			"Sun",
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat"
		].indexOf(n.weekday)
	};
}
function p(e, t) {
	if (o(e), !e.enabled) return null;
	let n = f(t, e.timezone);
	return n.time < e.time ? null : e.category === "weekly_report" ? n.weekday === e.weekday ? n.day : null : e.category === "monthly_report" ? Number(n.day.slice(-2)) <= 7 && n.weekday === e.weekday ? n.day.slice(0, 7) : null : e.category === "annual_pulse" ? n.day.slice(5) === "01-01" ? String(Number(n.day.slice(0, 4)) - 1) : null : [
		"daily_games",
		"daily_learning",
		"exam_reminders"
	].includes(e.category) ? n.day : null;
}
function m(e, t) {
	let n = /* @__PURE__ */ new Date(`${e}T00:00:00Z`);
	n.setUTCDate(n.getUTCDate() - 1);
	let r = new Date(n);
	return t === "week" ? r.setUTCDate(r.getUTCDate() - 6) : t === "month" ? (r.setUTCDate(1), n.getUTCDate() !== new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate() && (n.setUTCDate(0), r.setUTCMonth(r.getUTCMonth() - 1))) : r.setUTCFullYear(n.getUTCFullYear(), 0, 1), {
		start: r.toISOString().slice(0, 10),
		end: n.toISOString().slice(0, 10)
	};
}
//#endregion
//#region web/node_modules/react/cjs/react.production.min.js
var h = /* @__PURE__ */ e(((e) => {
	var t = Symbol.for("react.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.provider"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.iterator;
	function p(e) {
		return typeof e != "object" || !e ? null : (e = f && e[f] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var m = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, h = Object.assign, g = {};
	function _(e, t, n) {
		this.props = e, this.context = t, this.refs = g, this.updater = n || m;
	}
	_.prototype.isReactComponent = {}, _.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, _.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function v() {}
	v.prototype = _.prototype;
	function y(e, t, n) {
		this.props = e, this.context = t, this.refs = g, this.updater = n || m;
	}
	var b = y.prototype = new v();
	b.constructor = y, h(b, _.prototype), b.isPureReactComponent = !0;
	var x = Array.isArray, S = Object.prototype.hasOwnProperty, C = { current: null }, w = {
		key: !0,
		ref: !0,
		__self: !0,
		__source: !0
	};
	function T(e, n, r) {
		var i, a = {}, o = null, s = null;
		if (n != null) for (i in n.ref !== void 0 && (s = n.ref), n.key !== void 0 && (o = "" + n.key), n) S.call(n, i) && !w.hasOwnProperty(i) && (a[i] = n[i]);
		var c = arguments.length - 2;
		if (c === 1) a.children = r;
		else if (1 < c) {
			for (var l = Array(c), u = 0; u < c; u++) l[u] = arguments[u + 2];
			a.children = l;
		}
		if (e && e.defaultProps) for (i in c = e.defaultProps, c) a[i] === void 0 && (a[i] = c[i]);
		return {
			$$typeof: t,
			type: e,
			key: o,
			ref: s,
			props: a,
			_owner: C.current
		};
	}
	function E(e, n) {
		return {
			$$typeof: t,
			type: e.type,
			key: n,
			ref: e.ref,
			props: e.props,
			_owner: e._owner
		};
	}
	function D(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function O(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var ee = /\/+/g;
	function k(e, t) {
		return typeof e == "object" && e && e.key != null ? O("" + e.key) : t.toString(36);
	}
	function te(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n: c = !0;
			}
		}
		if (c) return c = e, o = o(c), e = a === "" ? "." + k(c, 0) : a, x(o) ? (i = "", e != null && (i = e.replace(ee, "$&/") + "/"), te(o, r, i, "", function(e) {
			return e;
		})) : o != null && (D(o) && (o = E(o, i + (!o.key || c && c.key === o.key ? "" : ("" + o.key).replace(ee, "$&/") + "/") + e)), r.push(o)), 1;
		if (c = 0, a = a === "" ? "." : a + ":", x(e)) for (var l = 0; l < e.length; l++) {
			s = e[l];
			var u = a + k(s, l);
			c += te(s, r, i, u, o);
		}
		else if (u = p(e), typeof u == "function") for (e = u.call(e), l = 0; !(s = e.next()).done;) s = s.value, u = a + k(s, l++), c += te(s, r, i, u, o);
		else if (s === "object") throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		return c;
	}
	function A(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return te(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function j(e) {
		if (e._status === -1) {
			var t = e._result;
			t = t(), t.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t);
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t);
			}), e._status === -1 && (e._status = 0, e._result = t);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var M = { current: null }, ne = { transition: null }, N = {
		ReactCurrentDispatcher: M,
		ReactCurrentBatchConfig: ne,
		ReactCurrentOwner: C
	};
	function P() {
		throw Error("act(...) is not supported in production builds of React.");
	}
	e.Children = {
		map: A,
		forEach: function(e, t, n) {
			A(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return A(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return A(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!D(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	}, e.Component = _, e.Fragment = r, e.Profiler = a, e.PureComponent = y, e.StrictMode = i, e.Suspense = l, e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = N, e.act = P, e.cloneElement = function(e, n, r) {
		if (e == null) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + e + ".");
		var i = h({}, e.props), a = e.key, o = e.ref, s = e._owner;
		if (n != null) {
			if (n.ref !== void 0 && (o = n.ref, s = C.current), n.key !== void 0 && (a = "" + n.key), e.type && e.type.defaultProps) var c = e.type.defaultProps;
			for (l in n) S.call(n, l) && !w.hasOwnProperty(l) && (i[l] = n[l] === void 0 && c !== void 0 ? c[l] : n[l]);
		}
		var l = arguments.length - 2;
		if (l === 1) i.children = r;
		else if (1 < l) {
			c = Array(l);
			for (var u = 0; u < l; u++) c[u] = arguments[u + 2];
			i.children = c;
		}
		return {
			$$typeof: t,
			type: e.type,
			key: a,
			ref: o,
			props: i,
			_owner: s
		};
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null,
			_defaultValue: null,
			_globalName: null
		}, e.Provider = {
			$$typeof: o,
			_context: e
		}, e.Consumer = e;
	}, e.createElement = T, e.createFactory = function(e) {
		var t = T.bind(null, e);
		return t.type = e, t;
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = D, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: j
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = function(e) {
		var t = ne.transition;
		ne.transition = {};
		try {
			e();
		} finally {
			ne.transition = t;
		}
	}, e.unstable_act = P, e.useCallback = function(e, t) {
		return M.current.useCallback(e, t);
	}, e.useContext = function(e) {
		return M.current.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e) {
		return M.current.useDeferredValue(e);
	}, e.useEffect = function(e, t) {
		return M.current.useEffect(e, t);
	}, e.useId = function() {
		return M.current.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return M.current.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return M.current.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return M.current.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return M.current.useMemo(e, t);
	}, e.useReducer = function(e, t, n) {
		return M.current.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return M.current.useRef(e);
	}, e.useState = function(e) {
		return M.current.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return M.current.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return M.current.useTransition();
	}, e.version = "18.3.1";
})), g = /* @__PURE__ */ e(((e, t) => {
	t.exports = h();
})), _ = /* @__PURE__ */ e(((e) => {
	var t = g();
	function n(e) {
		for (var t = "https://reactjs.org/docs/error-decoder.html?invariant=" + e, n = 1; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	var r = Object.prototype.hasOwnProperty, i = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, a = {}, o = {};
	function s(e) {
		return r.call(o, e) ? !0 : r.call(a, e) ? !1 : i.test(e) ? o[e] = !0 : (a[e] = !0, !1);
	}
	function c(e, t, n, r, i, a, o) {
		this.acceptsBooleans = t === 2 || t === 3 || t === 4, this.attributeName = r, this.attributeNamespace = i, this.mustUseProperty = n, this.propertyName = e, this.type = t, this.sanitizeURL = a, this.removeEmptyString = o;
	}
	var l = {};
	"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(e) {
		l[e] = new c(e, 0, !1, e, null, !1, !1);
	}), [
		["acceptCharset", "accept-charset"],
		["className", "class"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"]
	].forEach(function(e) {
		var t = e[0];
		l[t] = new c(t, 1, !1, e[1], null, !1, !1);
	}), [
		"contentEditable",
		"draggable",
		"spellCheck",
		"value"
	].forEach(function(e) {
		l[e] = new c(e, 2, !1, e.toLowerCase(), null, !1, !1);
	}), [
		"autoReverse",
		"externalResourcesRequired",
		"focusable",
		"preserveAlpha"
	].forEach(function(e) {
		l[e] = new c(e, 2, !1, e, null, !1, !1);
	}), "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(e) {
		l[e] = new c(e, 3, !1, e.toLowerCase(), null, !1, !1);
	}), [
		"checked",
		"multiple",
		"muted",
		"selected"
	].forEach(function(e) {
		l[e] = new c(e, 3, !0, e, null, !1, !1);
	}), ["capture", "download"].forEach(function(e) {
		l[e] = new c(e, 4, !1, e, null, !1, !1);
	}), [
		"cols",
		"rows",
		"size",
		"span"
	].forEach(function(e) {
		l[e] = new c(e, 6, !1, e, null, !1, !1);
	}), ["rowSpan", "start"].forEach(function(e) {
		l[e] = new c(e, 5, !1, e.toLowerCase(), null, !1, !1);
	});
	var u = /[\-:]([a-z])/g;
	function d(e) {
		return e[1].toUpperCase();
	}
	"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(e) {
		var t = e.replace(u, d);
		l[t] = new c(t, 1, !1, e, null, !1, !1);
	}), "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(e) {
		var t = e.replace(u, d);
		l[t] = new c(t, 1, !1, e, "http://www.w3.org/1999/xlink", !1, !1);
	}), [
		"xml:base",
		"xml:lang",
		"xml:space"
	].forEach(function(e) {
		var t = e.replace(u, d);
		l[t] = new c(t, 1, !1, e, "http://www.w3.org/XML/1998/namespace", !1, !1);
	}), ["tabIndex", "crossOrigin"].forEach(function(e) {
		l[e] = new c(e, 1, !1, e.toLowerCase(), null, !1, !1);
	}), l.xlinkHref = new c("xlinkHref", 1, !1, "xlink:href", "http://www.w3.org/1999/xlink", !0, !1), [
		"src",
		"href",
		"action",
		"formAction"
	].forEach(function(e) {
		l[e] = new c(e, 1, !1, e.toLowerCase(), null, !0, !0);
	});
	var f = {
		animationIterationCount: !0,
		aspectRatio: !0,
		borderImageOutset: !0,
		borderImageSlice: !0,
		borderImageWidth: !0,
		boxFlex: !0,
		boxFlexGroup: !0,
		boxOrdinalGroup: !0,
		columnCount: !0,
		columns: !0,
		flex: !0,
		flexGrow: !0,
		flexPositive: !0,
		flexShrink: !0,
		flexNegative: !0,
		flexOrder: !0,
		gridArea: !0,
		gridRow: !0,
		gridRowEnd: !0,
		gridRowSpan: !0,
		gridRowStart: !0,
		gridColumn: !0,
		gridColumnEnd: !0,
		gridColumnSpan: !0,
		gridColumnStart: !0,
		fontWeight: !0,
		lineClamp: !0,
		lineHeight: !0,
		opacity: !0,
		order: !0,
		orphans: !0,
		tabSize: !0,
		widows: !0,
		zIndex: !0,
		zoom: !0,
		fillOpacity: !0,
		floodOpacity: !0,
		stopOpacity: !0,
		strokeDasharray: !0,
		strokeDashoffset: !0,
		strokeMiterlimit: !0,
		strokeOpacity: !0,
		strokeWidth: !0
	}, p = [
		"Webkit",
		"ms",
		"Moz",
		"O"
	];
	Object.keys(f).forEach(function(e) {
		p.forEach(function(t) {
			t = t + e.charAt(0).toUpperCase() + e.substring(1), f[t] = f[e];
		});
	});
	var m = /["'&<>]/;
	function h(e) {
		if (typeof e == "boolean" || typeof e == "number") return "" + e;
		e = "" + e;
		var t = m.exec(e);
		if (t) {
			var n = "", r, i = 0;
			for (r = t.index; r < e.length; r++) {
				switch (e.charCodeAt(r)) {
					case 34:
						t = "&quot;";
						break;
					case 38:
						t = "&amp;";
						break;
					case 39:
						t = "&#x27;";
						break;
					case 60:
						t = "&lt;";
						break;
					case 62:
						t = "&gt;";
						break;
					default: continue;
				}
				i !== r && (n += e.substring(i, r)), i = r + 1, n += t;
			}
			e = i === r ? n : n + e.substring(i, r);
		}
		return e;
	}
	var _ = /([A-Z])/g, v = /^ms-/, y = Array.isArray;
	function b(e, t) {
		return {
			insertionMode: e,
			selectedValue: t
		};
	}
	function x(e, t, n) {
		switch (t) {
			case "select": return b(1, n.value == null ? n.defaultValue : n.value);
			case "svg": return b(2, null);
			case "math": return b(3, null);
			case "foreignObject": return b(1, null);
			case "table": return b(4, null);
			case "thead":
			case "tbody":
			case "tfoot": return b(5, null);
			case "colgroup": return b(7, null);
			case "tr": return b(6, null);
		}
		return 4 <= e.insertionMode || e.insertionMode === 0 ? b(1, null) : e;
	}
	var S = /* @__PURE__ */ new Map();
	function C(e, t, i) {
		if (typeof i != "object") throw Error(n(62));
		for (var a in t = !0, i) if (r.call(i, a)) {
			var o = i[a];
			if (o != null && typeof o != "boolean" && o !== "") {
				if (a.indexOf("--") === 0) {
					var s = h(a);
					o = h(("" + o).trim());
				} else {
					s = a;
					var c = S.get(s);
					c === void 0 ? (c = h(s.replace(_, "-$1").toLowerCase().replace(v, "-ms-")), S.set(s, c), s = c) : s = c, o = typeof o == "number" ? o === 0 || r.call(f, a) ? "" + o : o + "px" : h(("" + o).trim());
				}
				t ? (t = !1, e.push(" style=\"", s, ":", o)) : e.push(";", s, ":", o);
			}
		}
		t || e.push("\"");
	}
	function w(e, t, n, r) {
		switch (n) {
			case "style":
				C(e, t, r);
				return;
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning": return;
		}
		if (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") {
			if (t = l.hasOwnProperty(n) ? l[n] : null, t !== null) {
				switch (typeof r) {
					case "function":
					case "symbol": return;
					case "boolean": if (!t.acceptsBooleans) return;
				}
				switch (n = t.attributeName, t.type) {
					case 3:
						r && e.push(" ", n, "=\"\"");
						break;
					case 4:
						!0 === r ? e.push(" ", n, "=\"\"") : !1 !== r && e.push(" ", n, "=\"", h(r), "\"");
						break;
					case 5:
						isNaN(r) || e.push(" ", n, "=\"", h(r), "\"");
						break;
					case 6:
						!isNaN(r) && 1 <= r && e.push(" ", n, "=\"", h(r), "\"");
						break;
					default: t.sanitizeURL && (r = "" + r), e.push(" ", n, "=\"", h(r), "\"");
				}
			} else if (s(n)) {
				switch (typeof r) {
					case "function":
					case "symbol": return;
					case "boolean": if (t = n.toLowerCase().slice(0, 5), t !== "data-" && t !== "aria-") return;
				}
				e.push(" ", n, "=\"", h(r), "\"");
			}
		}
	}
	function T(e, t, r) {
		if (t != null) {
			if (r != null) throw Error(n(60));
			if (typeof t != "object" || !("__html" in t)) throw Error(n(61));
			t = t.__html, t != null && e.push("" + t);
		}
	}
	function E(e) {
		var n = "";
		return t.Children.forEach(e, function(e) {
			e != null && (n += e);
		}), n;
	}
	function D(e, t, n, i) {
		e.push(k(n));
		var a = n = null, o;
		for (o in t) if (r.call(t, o)) {
			var s = t[o];
			if (s != null) switch (o) {
				case "children":
					n = s;
					break;
				case "dangerouslySetInnerHTML":
					a = s;
					break;
				default: w(e, i, o, s);
			}
		}
		return e.push(">"), T(e, a, n), typeof n == "string" ? (e.push(h(n)), null) : n;
	}
	var O = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/, ee = /* @__PURE__ */ new Map();
	function k(e) {
		var t = ee.get(e);
		if (t === void 0) {
			if (!O.test(e)) throw Error(n(65, e));
			t = "<" + e, ee.set(e, t);
		}
		return t;
	}
	function te(e, t, i, a, o) {
		switch (t) {
			case "select":
				e.push(k("select"));
				var c = null, l = null;
				for (p in i) if (r.call(i, p)) {
					var u = i[p];
					if (u != null) switch (p) {
						case "children":
							c = u;
							break;
						case "dangerouslySetInnerHTML":
							l = u;
							break;
						case "defaultValue":
						case "value": break;
						default: w(e, a, p, u);
					}
				}
				return e.push(">"), T(e, l, c), c;
			case "option":
				l = o.selectedValue, e.push(k("option"));
				var d = u = null, f = null, p = null;
				for (c in i) if (r.call(i, c)) {
					var m = i[c];
					if (m != null) switch (c) {
						case "children":
							u = m;
							break;
						case "selected":
							f = m;
							break;
						case "dangerouslySetInnerHTML":
							p = m;
							break;
						case "value": d = m;
						default: w(e, a, c, m);
					}
				}
				if (l != null) if (i = d === null ? E(u) : "" + d, y(l)) {
					for (a = 0; a < l.length; a++) if ("" + l[a] === i) {
						e.push(" selected=\"\"");
						break;
					}
				} else "" + l === i && e.push(" selected=\"\"");
				else f && e.push(" selected=\"\"");
				return e.push(">"), T(e, p, u), u;
			case "textarea":
				for (u in e.push(k("textarea")), p = l = c = null, i) if (r.call(i, u) && (d = i[u], d != null)) switch (u) {
					case "children":
						p = d;
						break;
					case "value":
						c = d;
						break;
					case "defaultValue":
						l = d;
						break;
					case "dangerouslySetInnerHTML": throw Error(n(91));
					default: w(e, a, u, d);
				}
				if (c === null && l !== null && (c = l), e.push(">"), p != null) {
					if (c != null) throw Error(n(92));
					if (y(p) && 1 < p.length) throw Error(n(93));
					c = "" + p;
				}
				return typeof c == "string" && c[0] === "\n" && e.push("\n"), c !== null && e.push(h("" + c)), null;
			case "input":
				for (l in e.push(k("input")), d = p = u = c = null, i) if (r.call(i, l) && (f = i[l], f != null)) switch (l) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(399, "input"));
					case "defaultChecked":
						d = f;
						break;
					case "defaultValue":
						u = f;
						break;
					case "checked":
						p = f;
						break;
					case "value":
						c = f;
						break;
					default: w(e, a, l, f);
				}
				return p === null ? d !== null && w(e, a, "checked", d) : w(e, a, "checked", p), c === null ? u !== null && w(e, a, "value", u) : w(e, a, "value", c), e.push("/>"), null;
			case "menuitem":
				for (var g in e.push(k("menuitem")), i) if (r.call(i, g) && (c = i[g], c != null)) switch (g) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(400));
					default: w(e, a, g, c);
				}
				return e.push(">"), null;
			case "title":
				for (m in e.push(k("title")), c = null, i) if (r.call(i, m) && (l = i[m], l != null)) switch (m) {
					case "children":
						c = l;
						break;
					case "dangerouslySetInnerHTML": throw Error(n(434));
					default: w(e, a, m, l);
				}
				return e.push(">"), c;
			case "listing":
			case "pre":
				for (d in e.push(k(t)), l = c = null, i) if (r.call(i, d) && (u = i[d], u != null)) switch (d) {
					case "children":
						c = u;
						break;
					case "dangerouslySetInnerHTML":
						l = u;
						break;
					default: w(e, a, d, u);
				}
				if (e.push(">"), l != null) {
					if (c != null) throw Error(n(60));
					if (typeof l != "object" || !("__html" in l)) throw Error(n(61));
					i = l.__html, i != null && (typeof i == "string" && 0 < i.length && i[0] === "\n" ? e.push("\n", i) : e.push("" + i));
				}
				return typeof c == "string" && c[0] === "\n" && e.push("\n"), c;
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "img":
			case "keygen":
			case "link":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
				for (var _ in e.push(k(t)), i) if (r.call(i, _) && (c = i[_], c != null)) switch (_) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(399, t));
					default: w(e, a, _, c);
				}
				return e.push("/>"), null;
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return D(e, i, t, a);
			case "html": return o.insertionMode === 0 && e.push("<!DOCTYPE html>"), D(e, i, t, a);
			default:
				if (t.indexOf("-") === -1 && typeof i.is != "string") return D(e, i, t, a);
				for (f in e.push(k(t)), l = c = null, i) if (r.call(i, f) && (u = i[f], u != null)) switch (f) {
					case "children":
						c = u;
						break;
					case "dangerouslySetInnerHTML":
						l = u;
						break;
					case "style":
						C(e, a, u);
						break;
					case "suppressContentEditableWarning":
					case "suppressHydrationWarning": break;
					default: s(f) && typeof u != "function" && typeof u != "symbol" && e.push(" ", f, "=\"", h(u), "\"");
				}
				return e.push(">"), T(e, l, c), c;
		}
	}
	function A(e, t, r) {
		if (e.push("<!--$?--><template id=\""), r === null) throw Error(n(395));
		return e.push(r), e.push("\"></template>");
	}
	function j(e, t, r, i) {
		switch (r.insertionMode) {
			case 0:
			case 1: return e.push("<div hidden id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 2: return e.push("<svg aria-hidden=\"true\" style=\"display:none\" id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 3: return e.push("<math aria-hidden=\"true\" style=\"display:none\" id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 4: return e.push("<table hidden id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 5: return e.push("<table hidden><tbody id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 6: return e.push("<table hidden><tr id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			case 7: return e.push("<table hidden><colgroup id=\""), e.push(t.segmentPrefix), t = i.toString(16), e.push(t), e.push("\">");
			default: throw Error(n(397));
		}
	}
	function M(e, t) {
		switch (t.insertionMode) {
			case 0:
			case 1: return e.push("</div>");
			case 2: return e.push("</svg>");
			case 3: return e.push("</math>");
			case 4: return e.push("</table>");
			case 5: return e.push("</tbody></table>");
			case 6: return e.push("</tr></table>");
			case 7: return e.push("</colgroup></table>");
			default: throw Error(n(397));
		}
	}
	var ne = /[<\u2028\u2029]/g;
	function N(e) {
		return JSON.stringify(e).replace(ne, function(e) {
			switch (e) {
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	function P(e, t) {
		return t = t === void 0 ? "" : t, {
			bootstrapChunks: [],
			startInlineScript: "<script>",
			placeholderPrefix: t + "P:",
			segmentPrefix: t + "S:",
			boundaryPrefix: t + "B:",
			idPrefix: t,
			nextSuspenseID: 0,
			sentCompleteSegmentFunction: !1,
			sentCompleteBoundaryFunction: !1,
			sentClientRenderFunction: !1,
			generateStaticMarkup: e
		};
	}
	function re(e, t, n, r) {
		return n.generateStaticMarkup ? (e.push(h(t)), !1) : (t === "" ? e = r : (r && e.push("<!-- -->"), e.push(h(t)), e = !0), e);
	}
	var ie = Object.assign, ae = Symbol.for("react.element"), oe = Symbol.for("react.portal"), se = Symbol.for("react.fragment"), ce = Symbol.for("react.strict_mode"), le = Symbol.for("react.profiler"), ue = Symbol.for("react.provider"), de = Symbol.for("react.context"), F = Symbol.for("react.forward_ref"), fe = Symbol.for("react.suspense"), I = Symbol.for("react.suspense_list"), pe = Symbol.for("react.memo"), L = Symbol.for("react.lazy"), R = Symbol.for("react.scope"), me = Symbol.for("react.debug_trace_mode"), he = Symbol.for("react.legacy_hidden"), ge = Symbol.for("react.default_value"), _e = Symbol.iterator;
	function ve(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case se: return "Fragment";
			case oe: return "Portal";
			case le: return "Profiler";
			case ce: return "StrictMode";
			case fe: return "Suspense";
			case I: return "SuspenseList";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case de: return (e.displayName || "Context") + ".Consumer";
			case ue: return (e._context.displayName || "Context") + ".Provider";
			case F:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case pe: return t = e.displayName || null, t === null ? ve(e.type) || "Memo" : t;
			case L:
				t = e._payload, e = e._init;
				try {
					return ve(e(t));
				} catch {}
		}
		return null;
	}
	var z = {};
	function ye(e, t) {
		if (e = e.contextTypes, !e) return z;
		var n = {}, r;
		for (r in e) n[r] = t[r];
		return n;
	}
	var be = null;
	function B(e, t) {
		if (e !== t) {
			e.context._currentValue2 = e.parentValue, e = e.parent;
			var r = t.parent;
			if (e === null) {
				if (r !== null) throw Error(n(401));
			} else {
				if (r === null) throw Error(n(401));
				B(e, r);
			}
			t.context._currentValue2 = t.value;
		}
	}
	function xe(e) {
		e.context._currentValue2 = e.parentValue, e = e.parent, e !== null && xe(e);
	}
	function Se(e) {
		var t = e.parent;
		t !== null && Se(t), e.context._currentValue2 = e.value;
	}
	function Ce(e, t) {
		if (e.context._currentValue2 = e.parentValue, e = e.parent, e === null) throw Error(n(402));
		e.depth === t.depth ? B(e, t) : Ce(e, t);
	}
	function we(e, t) {
		var r = t.parent;
		if (r === null) throw Error(n(402));
		e.depth === r.depth ? B(e, r) : we(e, r), t.context._currentValue2 = t.value;
	}
	function Te(e) {
		var t = be;
		t !== e && (t === null ? Se(e) : e === null ? xe(t) : t.depth === e.depth ? B(t, e) : t.depth > e.depth ? Ce(t, e) : we(t, e), be = e);
	}
	var Ee = {
		isMounted: function() {
			return !1;
		},
		enqueueSetState: function(e, t) {
			e = e._reactInternals, e.queue !== null && e.queue.push(t);
		},
		enqueueReplaceState: function(e, t) {
			e = e._reactInternals, e.replace = !0, e.queue = [t];
		},
		enqueueForceUpdate: function() {}
	};
	function De(e, t, n, r) {
		var i = e.state === void 0 ? null : e.state;
		e.updater = Ee, e.props = n, e.state = i;
		var a = {
			queue: [],
			replace: !1
		};
		e._reactInternals = a;
		var o = t.contextType;
		if (e.context = typeof o == "object" && o ? o._currentValue2 : r, o = t.getDerivedStateFromProps, typeof o == "function" && (o = o(n, i), i = o == null ? i : ie({}, i, o), e.state = i), typeof t.getDerivedStateFromProps != "function" && typeof e.getSnapshotBeforeUpdate != "function" && (typeof e.UNSAFE_componentWillMount == "function" || typeof e.componentWillMount == "function")) if (t = e.state, typeof e.componentWillMount == "function" && e.componentWillMount(), typeof e.UNSAFE_componentWillMount == "function" && e.UNSAFE_componentWillMount(), t !== e.state && Ee.enqueueReplaceState(e, e.state, null), a.queue !== null && 0 < a.queue.length) if (t = a.queue, o = a.replace, a.queue = null, a.replace = !1, o && t.length === 1) e.state = t[0];
		else {
			for (a = o ? t[0] : e.state, i = !0, o = +!!o; o < t.length; o++) {
				var s = t[o];
				s = typeof s == "function" ? s.call(e, a, n, r) : s, s != null && (i ? (i = !1, a = ie({}, a, s)) : ie(a, s));
			}
			e.state = a;
		}
		else a.queue = null;
	}
	var Oe = {
		id: 1,
		overflow: ""
	};
	function ke(e, t, n) {
		var r = e.id;
		e = e.overflow;
		var i = 32 - V(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - V(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			return a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, {
				id: 1 << 32 - V(t) + i | n << i | r,
				overflow: a + e
			};
		}
		return {
			id: 1 << a | n << i | r,
			overflow: e
		};
	}
	var V = Math.clz32 ? Math.clz32 : je, Ae = Math.log, H = Math.LN2;
	function je(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (Ae(e) / H | 0) | 0;
	}
	function Me(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var Ne = typeof Object.is == "function" ? Object.is : Me, U = null, Pe = null, Fe = null, W = null, Ie = !1, Le = !1, Re = 0, ze = null, Be = 0;
	function Ve() {
		if (U === null) throw Error(n(321));
		return U;
	}
	function He() {
		if (0 < Be) throw Error(n(312));
		return {
			memoizedState: null,
			queue: null,
			next: null
		};
	}
	function Ue() {
		return W === null ? Fe === null ? (Ie = !1, Fe = W = He()) : (Ie = !0, W = Fe) : W.next === null ? (Ie = !1, W = W.next = He()) : (Ie = !0, W = W.next), W;
	}
	function We() {
		Pe = U = null, Le = !1, Fe = null, Be = 0, W = ze = null;
	}
	function Ge(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function Ke(e, t, n) {
		if (U = Ve(), W = Ue(), Ie) {
			var r = W.queue;
			if (t = r.dispatch, ze !== null && (n = ze.get(r), n !== void 0)) {
				ze.delete(r), r = W.memoizedState;
				do
					r = e(r, n.action), n = n.next;
				while (n !== null);
				return W.memoizedState = r, [r, t];
			}
			return [W.memoizedState, t];
		}
		return e = e === Ge ? typeof t == "function" ? t() : t : n === void 0 ? t : n(t), W.memoizedState = e, e = W.queue = {
			last: null,
			dispatch: null
		}, e = e.dispatch = Je.bind(null, U, e), [W.memoizedState, e];
	}
	function qe(e, t) {
		if (U = Ve(), W = Ue(), t = t === void 0 ? null : t, W !== null) {
			var n = W.memoizedState;
			if (n !== null && t !== null) {
				var r = n[1];
				a: if (r === null) r = !1;
				else {
					for (var i = 0; i < r.length && i < t.length; i++) if (!Ne(t[i], r[i])) {
						r = !1;
						break a;
					}
					r = !0;
				}
				if (r) return n[0];
			}
		}
		return e = e(), W.memoizedState = [e, t], e;
	}
	function Je(e, t, r) {
		if (25 <= Be) throw Error(n(301));
		if (e === U) if (Le = !0, e = {
			action: r,
			next: null
		}, ze === null && (ze = /* @__PURE__ */ new Map()), r = ze.get(t), r === void 0) ze.set(t, e);
		else {
			for (t = r; t.next !== null;) t = t.next;
			t.next = e;
		}
	}
	function Ye() {
		throw Error(n(394));
	}
	function Xe() {}
	var Ze = {
		readContext: function(e) {
			return e._currentValue2;
		},
		useContext: function(e) {
			return Ve(), e._currentValue2;
		},
		useMemo: qe,
		useReducer: Ke,
		useRef: function(e) {
			U = Ve(), W = Ue();
			var t = W.memoizedState;
			return t === null ? (e = { current: e }, W.memoizedState = e) : t;
		},
		useState: function(e) {
			return Ke(Ge, e);
		},
		useInsertionEffect: Xe,
		useLayoutEffect: function() {},
		useCallback: function(e, t) {
			return qe(function() {
				return e;
			}, t);
		},
		useImperativeHandle: Xe,
		useEffect: Xe,
		useDebugValue: Xe,
		useDeferredValue: function(e) {
			return Ve(), e;
		},
		useTransition: function() {
			return Ve(), [!1, Ye];
		},
		useId: function() {
			var e = Pe.treeContext, t = e.overflow;
			e = e.id, e = (e & ~(1 << 32 - V(e) - 1)).toString(32) + t;
			var r = Qe;
			if (r === null) throw Error(n(404));
			return t = Re++, e = ":" + r.idPrefix + "R" + e, 0 < t && (e += "H" + t.toString(32)), e + ":";
		},
		useMutableSource: function(e, t) {
			return Ve(), t(e._source);
		},
		useSyncExternalStore: function(e, t, r) {
			if (r === void 0) throw Error(n(407));
			return r();
		}
	}, Qe = null, $e = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
	function et(e) {
		return console.error(e), null;
	}
	function tt() {}
	function nt(e, t, n, r, i, a, o, s, c) {
		var l = [], u = /* @__PURE__ */ new Set();
		return t = {
			destination: null,
			responseState: t,
			progressiveChunkSize: r === void 0 ? 12800 : r,
			status: 0,
			fatalError: null,
			nextSegmentId: 0,
			allPendingTasks: 0,
			pendingRootTasks: 0,
			completedRootSegment: null,
			abortableTasks: u,
			pingedTasks: l,
			clientRenderedBoundaries: [],
			completedBoundaries: [],
			partialBoundaries: [],
			onError: i === void 0 ? et : i,
			onAllReady: a === void 0 ? tt : a,
			onShellReady: o === void 0 ? tt : o,
			onShellError: s === void 0 ? tt : s,
			onFatalError: c === void 0 ? tt : c
		}, n = it(t, 0, null, n, !1, !1), n.parentFlushed = !0, e = rt(t, e, null, n, u, z, null, Oe), l.push(e), t;
	}
	function rt(e, t, n, r, i, a, o, s) {
		e.allPendingTasks++, n === null ? e.pendingRootTasks++ : n.pendingTasks++;
		var c = {
			node: t,
			ping: function() {
				var t = e.pingedTasks;
				t.push(c), t.length === 1 && ht(e);
			},
			blockedBoundary: n,
			blockedSegment: r,
			abortSet: i,
			legacyContext: a,
			context: o,
			treeContext: s
		};
		return i.add(c), c;
	}
	function it(e, t, n, r, i, a) {
		return {
			status: 0,
			id: -1,
			index: t,
			parentFlushed: !1,
			chunks: [],
			children: [],
			formatContext: r,
			boundary: n,
			lastPushedText: i,
			textEmbedded: a
		};
	}
	function at(e, t) {
		if (e = e.onError(t), e != null && typeof e != "string") throw Error("onError returned something with a type other than \"string\". onError should return a string and may return null or undefined but must not return anything else. It received something of type \"" + typeof e + "\" instead");
		return e;
	}
	function ot(e, t) {
		var n = e.onShellError;
		n(t), n = e.onFatalError, n(t), e.destination === null ? (e.status = 1, e.fatalError = t) : (e.status = 2, e.destination.destroy(t));
	}
	function st(e, t, n, r, i) {
		for (U = {}, Pe = t, Re = 0, e = n(r, i); Le;) Le = !1, Re = 0, Be += 1, W = null, e = n(r, i);
		return We(), e;
	}
	function ct(e, t, r, i) {
		var a = r.render(), o = i.childContextTypes;
		if (o != null) {
			var s = t.legacyContext;
			if (typeof r.getChildContext != "function") i = s;
			else {
				for (var c in r = r.getChildContext(), r) if (!(c in o)) throw Error(n(108, ve(i) || "Unknown", c));
				i = ie({}, s, r);
			}
			t.legacyContext = i, G(e, t, a), t.legacyContext = s;
		} else G(e, t, a);
	}
	function lt(e, t) {
		if (e && e.defaultProps) {
			for (var n in t = ie({}, t), e = e.defaultProps, e) t[n] === void 0 && (t[n] = e[n]);
			return t;
		}
		return t;
	}
	function ut(e, t, r, i, a) {
		if (typeof r == "function") if (r.prototype && r.prototype.isReactComponent) {
			a = ye(r, t.legacyContext);
			var o = r.contextType;
			o = new r(i, typeof o == "object" && o ? o._currentValue2 : a), De(o, r, i, a), ct(e, t, o, r);
		} else {
			o = ye(r, t.legacyContext), a = st(e, t, r, i, o);
			var s = Re !== 0;
			if (typeof a == "object" && a && typeof a.render == "function" && a.$$typeof === void 0) De(a, r, i, o), ct(e, t, a, r);
			else if (s) {
				i = t.treeContext, t.treeContext = ke(i, 1, 0);
				try {
					G(e, t, a);
				} finally {
					t.treeContext = i;
				}
			} else G(e, t, a);
		}
		else if (typeof r == "string") {
			switch (a = t.blockedSegment, o = te(a.chunks, r, i, e.responseState, a.formatContext), a.lastPushedText = !1, s = a.formatContext, a.formatContext = x(s, r, i), ft(e, t, o), a.formatContext = s, r) {
				case "area":
				case "base":
				case "br":
				case "col":
				case "embed":
				case "hr":
				case "img":
				case "input":
				case "keygen":
				case "link":
				case "meta":
				case "param":
				case "source":
				case "track":
				case "wbr": break;
				default: a.chunks.push("</", r, ">");
			}
			a.lastPushedText = !1;
		} else {
			switch (r) {
				case he:
				case me:
				case ce:
				case le:
				case se:
					G(e, t, i.children);
					return;
				case I:
					G(e, t, i.children);
					return;
				case R: throw Error(n(343));
				case fe:
					a: {
						r = t.blockedBoundary, a = t.blockedSegment, o = i.fallback, i = i.children, s = /* @__PURE__ */ new Set();
						var c = {
							id: null,
							rootSegmentID: -1,
							parentFlushed: !1,
							pendingTasks: 0,
							forceClientRender: !1,
							completedSegments: [],
							byteSize: 0,
							fallbackAbortableTasks: s,
							errorDigest: null
						}, l = it(e, a.chunks.length, c, a.formatContext, !1, !1);
						a.children.push(l), a.lastPushedText = !1;
						var u = it(e, 0, null, a.formatContext, !1, !1);
						u.parentFlushed = !0, t.blockedBoundary = c, t.blockedSegment = u;
						try {
							if (ft(e, t, i), e.responseState.generateStaticMarkup || u.lastPushedText && u.textEmbedded && u.chunks.push("<!-- -->"), u.status = 1, mt(c, u), c.pendingTasks === 0) break a;
						} catch (t) {
							u.status = 4, c.forceClientRender = !0, c.errorDigest = at(e, t);
						} finally {
							t.blockedBoundary = r, t.blockedSegment = a;
						}
						t = rt(e, o, r, l, s, t.legacyContext, t.context, t.treeContext), e.pingedTasks.push(t);
					}
					return;
			}
			if (typeof r == "object" && r) switch (r.$$typeof) {
				case F:
					if (i = st(e, t, r.render, i, a), Re !== 0) {
						r = t.treeContext, t.treeContext = ke(r, 1, 0);
						try {
							G(e, t, i);
						} finally {
							t.treeContext = r;
						}
					} else G(e, t, i);
					return;
				case pe:
					r = r.type, i = lt(r, i), ut(e, t, r, i, a);
					return;
				case ue:
					if (a = i.children, r = r._context, i = i.value, o = r._currentValue2, r._currentValue2 = i, s = be, be = i = {
						parent: s,
						depth: s === null ? 0 : s.depth + 1,
						context: r,
						parentValue: o,
						value: i
					}, t.context = i, G(e, t, a), e = be, e === null) throw Error(n(403));
					i = e.parentValue, e.context._currentValue2 = i === ge ? e.context._defaultValue : i, e = be = e.parent, t.context = e;
					return;
				case de:
					i = i.children, i = i(r._currentValue2), G(e, t, i);
					return;
				case L:
					a = r._init, r = a(r._payload), i = lt(r, i), ut(e, t, r, i, void 0);
					return;
			}
			throw Error(n(130, r == null ? r : typeof r, ""));
		}
	}
	function G(e, t, r) {
		if (t.node = r, typeof r == "object" && r) {
			switch (r.$$typeof) {
				case ae:
					ut(e, t, r.type, r.props, r.ref);
					return;
				case oe: throw Error(n(257));
				case L:
					var i = r._init;
					r = i(r._payload), G(e, t, r);
					return;
			}
			if (y(r)) {
				dt(e, t, r);
				return;
			}
			if (typeof r != "object" || !r ? i = null : (i = _e && r[_e] || r["@@iterator"], i = typeof i == "function" ? i : null), i &&= i.call(r)) {
				if (r = i.next(), !r.done) {
					var a = [];
					do
						a.push(r.value), r = i.next();
					while (!r.done);
					dt(e, t, a);
				}
				return;
			}
			throw e = Object.prototype.toString.call(r), Error(n(31, e === "[object Object]" ? "object with keys {" + Object.keys(r).join(", ") + "}" : e));
		}
		typeof r == "string" ? (i = t.blockedSegment, i.lastPushedText = re(t.blockedSegment.chunks, r, e.responseState, i.lastPushedText)) : typeof r == "number" && (i = t.blockedSegment, i.lastPushedText = re(t.blockedSegment.chunks, "" + r, e.responseState, i.lastPushedText));
	}
	function dt(e, t, n) {
		for (var r = n.length, i = 0; i < r; i++) {
			var a = t.treeContext;
			t.treeContext = ke(a, r, i);
			try {
				ft(e, t, n[i]);
			} finally {
				t.treeContext = a;
			}
		}
	}
	function ft(e, t, n) {
		var r = t.blockedSegment.formatContext, i = t.legacyContext, a = t.context;
		try {
			return G(e, t, n);
		} catch (c) {
			if (We(), typeof c == "object" && c && typeof c.then == "function") {
				n = c;
				var o = t.blockedSegment, s = it(e, o.chunks.length, null, o.formatContext, o.lastPushedText, !0);
				o.children.push(s), o.lastPushedText = !1, e = rt(e, t.node, t.blockedBoundary, s, t.abortSet, t.legacyContext, t.context, t.treeContext).ping, n.then(e, e), t.blockedSegment.formatContext = r, t.legacyContext = i, t.context = a, Te(a);
			} else throw t.blockedSegment.formatContext = r, t.legacyContext = i, t.context = a, Te(a), c;
		}
	}
	function K(e) {
		var t = e.blockedBoundary;
		e = e.blockedSegment, e.status = 3, q(this, t, e);
	}
	function pt(e, t, r) {
		var i = e.blockedBoundary;
		e.blockedSegment.status = 3, i === null ? (t.allPendingTasks--, t.status !== 2 && (t.status = 2, t.destination !== null && t.destination.push(null))) : (i.pendingTasks--, i.forceClientRender || (i.forceClientRender = !0, e = r === void 0 ? Error(n(432)) : r, i.errorDigest = t.onError(e), i.parentFlushed && t.clientRenderedBoundaries.push(i)), i.fallbackAbortableTasks.forEach(function(e) {
			return pt(e, t, r);
		}), i.fallbackAbortableTasks.clear(), t.allPendingTasks--, t.allPendingTasks === 0 && (i = t.onAllReady, i()));
	}
	function mt(e, t) {
		if (t.chunks.length === 0 && t.children.length === 1 && t.children[0].boundary === null) {
			var n = t.children[0];
			n.id = t.id, n.parentFlushed = !0, n.status === 1 && mt(e, n);
		} else e.completedSegments.push(t);
	}
	function q(e, t, r) {
		if (t === null) {
			if (r.parentFlushed) {
				if (e.completedRootSegment !== null) throw Error(n(389));
				e.completedRootSegment = r;
			}
			e.pendingRootTasks--, e.pendingRootTasks === 0 && (e.onShellError = tt, t = e.onShellReady, t());
		} else t.pendingTasks--, t.forceClientRender || (t.pendingTasks === 0 ? (r.parentFlushed && r.status === 1 && mt(t, r), t.parentFlushed && e.completedBoundaries.push(t), t.fallbackAbortableTasks.forEach(K, e), t.fallbackAbortableTasks.clear()) : r.parentFlushed && r.status === 1 && (mt(t, r), t.completedSegments.length === 1 && t.parentFlushed && e.partialBoundaries.push(t)));
		e.allPendingTasks--, e.allPendingTasks === 0 && (e = e.onAllReady, e());
	}
	function ht(e) {
		if (e.status !== 2) {
			var t = be, n = $e.current;
			$e.current = Ze;
			var r = Qe;
			Qe = e.responseState;
			try {
				var i = e.pingedTasks, a;
				for (a = 0; a < i.length; a++) {
					var o = i[a], s = e, c = o.blockedSegment;
					if (c.status === 0) {
						Te(o.context);
						try {
							G(s, o, o.node), s.responseState.generateStaticMarkup || c.lastPushedText && c.textEmbedded && c.chunks.push("<!-- -->"), o.abortSet.delete(o), c.status = 1, q(s, o.blockedBoundary, c);
						} catch (e) {
							if (We(), typeof e == "object" && e && typeof e.then == "function") {
								var l = o.ping;
								e.then(l, l);
							} else {
								o.abortSet.delete(o), c.status = 4;
								var u = o.blockedBoundary, d = e, f = at(s, d);
								if (u === null ? ot(s, d) : (u.pendingTasks--, u.forceClientRender || (u.forceClientRender = !0, u.errorDigest = f, u.parentFlushed && s.clientRenderedBoundaries.push(u))), s.allPendingTasks--, s.allPendingTasks === 0) {
									var p = s.onAllReady;
									p();
								}
							}
						}
					}
				}
				i.splice(0, a), e.destination !== null && yt(e, e.destination);
			} catch (t) {
				at(e, t), ot(e, t);
			} finally {
				Qe = r, $e.current = n, n === Ze && Te(t);
			}
		}
	}
	function gt(e, t, r) {
		switch (r.parentFlushed = !0, r.status) {
			case 0:
				var i = r.id = e.nextSegmentId++;
				return r.lastPushedText = !1, r.textEmbedded = !1, e = e.responseState, t.push("<template id=\""), t.push(e.placeholderPrefix), e = i.toString(16), t.push(e), t.push("\"></template>");
			case 1:
				r.status = 2;
				var a = !0;
				i = r.chunks;
				var o = 0;
				r = r.children;
				for (var s = 0; s < r.length; s++) {
					for (a = r[s]; o < a.index; o++) t.push(i[o]);
					a = _t(e, t, a);
				}
				for (; o < i.length - 1; o++) t.push(i[o]);
				return o < i.length && (a = t.push(i[o])), a;
			default: throw Error(n(390));
		}
	}
	function _t(e, t, r) {
		var i = r.boundary;
		if (i === null) return gt(e, t, r);
		if (i.parentFlushed = !0, i.forceClientRender) return e.responseState.generateStaticMarkup || (i = i.errorDigest, t.push("<!--$!-->"), t.push("<template"), i && (t.push(" data-dgst=\""), i = h(i), t.push(i), t.push("\"")), t.push("></template>")), gt(e, t, r), e = e.responseState.generateStaticMarkup ? !0 : t.push("<!--/$-->"), e;
		if (0 < i.pendingTasks) {
			i.rootSegmentID = e.nextSegmentId++, 0 < i.completedSegments.length && e.partialBoundaries.push(i);
			var a = e.responseState, o = a.nextSuspenseID++;
			return a = a.boundaryPrefix + o.toString(16), i = i.id = a, A(t, e.responseState, i), gt(e, t, r), t.push("<!--/$-->");
		}
		if (i.byteSize > e.progressiveChunkSize) return i.rootSegmentID = e.nextSegmentId++, e.completedBoundaries.push(i), A(t, e.responseState, i.id), gt(e, t, r), t.push("<!--/$-->");
		if (e.responseState.generateStaticMarkup || t.push("<!--$-->"), r = i.completedSegments, r.length !== 1) throw Error(n(391));
		return _t(e, t, r[0]), e = e.responseState.generateStaticMarkup ? !0 : t.push("<!--/$-->"), e;
	}
	function J(e, t, n) {
		return j(t, e.responseState, n.formatContext, n.id), _t(e, t, n), M(t, n.formatContext);
	}
	function Y(e, t, r) {
		for (var i = r.completedSegments, a = 0; a < i.length; a++) vt(e, t, r, i[a]);
		if (i.length = 0, e = e.responseState, i = r.id, r = r.rootSegmentID, t.push(e.startInlineScript), e.sentCompleteBoundaryFunction ? t.push("$RC(\"") : (e.sentCompleteBoundaryFunction = !0, t.push("function $RC(a,b){a=document.getElementById(a);b=document.getElementById(b);b.parentNode.removeChild(b);if(a){a=a.previousSibling;var f=a.parentNode,c=a.nextSibling,e=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d)if(0===e)break;else e--;else\"$\"!==d&&\"$?\"!==d&&\"$!\"!==d||e++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;b.firstChild;)f.insertBefore(b.firstChild,c);a.data=\"$\";a._reactRetry&&a._reactRetry()}};$RC(\"")), i === null) throw Error(n(395));
		return r = r.toString(16), t.push(i), t.push("\",\""), t.push(e.segmentPrefix), t.push(r), t.push("\")<\/script>");
	}
	function vt(e, t, r, i) {
		if (i.status === 2) return !0;
		var a = i.id;
		if (a === -1) {
			if ((i.id = r.rootSegmentID) === -1) throw Error(n(392));
			return J(e, t, i);
		}
		return J(e, t, i), e = e.responseState, t.push(e.startInlineScript), e.sentCompleteSegmentFunction ? t.push("$RS(\"") : (e.sentCompleteSegmentFunction = !0, t.push("function $RS(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS(\"")), t.push(e.segmentPrefix), a = a.toString(16), t.push(a), t.push("\",\""), t.push(e.placeholderPrefix), t.push(a), t.push("\")<\/script>");
	}
	function yt(e, t) {
		try {
			var r = e.completedRootSegment;
			if (r !== null && e.pendingRootTasks === 0) {
				_t(e, t, r), e.completedRootSegment = null;
				var i = e.responseState.bootstrapChunks;
				for (r = 0; r < i.length - 1; r++) t.push(i[r]);
				r < i.length && t.push(i[r]);
			}
			var a = e.clientRenderedBoundaries, o;
			for (o = 0; o < a.length; o++) {
				var s = a[o];
				i = t;
				var c = e.responseState, l = s.id, u = s.errorDigest, d = s.errorMessage, f = s.errorComponentStack;
				if (i.push(c.startInlineScript), c.sentClientRenderFunction ? i.push("$RX(\"") : (c.sentClientRenderFunction = !0, i.push("function $RX(b,c,d,e){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),b._reactRetry&&b._reactRetry())};$RX(\"")), l === null) throw Error(n(395));
				if (i.push(l), i.push("\""), u || d || f) {
					i.push(",");
					var p = N(u || "");
					i.push(p);
				}
				if (d || f) {
					i.push(",");
					var m = N(d || "");
					i.push(m);
				}
				if (f) {
					i.push(",");
					var h = N(f);
					i.push(h);
				}
				if (!i.push(")<\/script>")) {
					e.destination = null, o++, a.splice(0, o);
					return;
				}
			}
			a.splice(0, o);
			var g = e.completedBoundaries;
			for (o = 0; o < g.length; o++) if (!Y(e, t, g[o])) {
				e.destination = null, o++, g.splice(0, o);
				return;
			}
			g.splice(0, o);
			var _ = e.partialBoundaries;
			for (o = 0; o < _.length; o++) {
				var v = _[o];
				a: {
					a = e, s = t;
					var y = v.completedSegments;
					for (c = 0; c < y.length; c++) if (!vt(a, s, v, y[c])) {
						c++, y.splice(0, c);
						var b = !1;
						break a;
					}
					y.splice(0, c), b = !0;
				}
				if (!b) {
					e.destination = null, o++, _.splice(0, o);
					return;
				}
			}
			_.splice(0, o);
			var x = e.completedBoundaries;
			for (o = 0; o < x.length; o++) if (!Y(e, t, x[o])) {
				e.destination = null, o++, x.splice(0, o);
				return;
			}
			x.splice(0, o);
		} finally {
			e.allPendingTasks === 0 && e.pingedTasks.length === 0 && e.clientRenderedBoundaries.length === 0 && e.completedBoundaries.length === 0 && t.push(null);
		}
	}
	function bt(e, t) {
		try {
			var n = e.abortableTasks;
			n.forEach(function(n) {
				return pt(n, e, t);
			}), n.clear(), e.destination !== null && yt(e, e.destination);
		} catch (t) {
			at(e, t), ot(e, t);
		}
	}
	function xt() {}
	function St(e, t, r, i) {
		var a = !1, o = null, s = "", c = {
			push: function(e) {
				return e !== null && (s += e), !0;
			},
			destroy: function(e) {
				a = !0, o = e;
			}
		}, l = !1;
		if (e = nt(e, P(r, t ? t.identifierPrefix : void 0), {
			insertionMode: 1,
			selectedValue: null
		}, Infinity, xt, void 0, function() {
			l = !0;
		}, void 0, void 0), ht(e), bt(e, i), e.status === 1) e.status = 2, c.destroy(e.fatalError);
		else if (e.status !== 2 && e.destination === null) {
			e.destination = c;
			try {
				yt(e, c);
			} catch (t) {
				at(e, t), ot(e, t);
			}
		}
		if (a) throw o;
		if (!l) throw Error(n(426));
		return s;
	}
	e.renderToNodeStream = function() {
		throw Error(n(207));
	}, e.renderToStaticMarkup = function(e, t) {
		return St(e, t, !0, "The server used \"renderToStaticMarkup\" which does not support Suspense. If you intended to have the server wait for the suspended component please switch to \"renderToReadableStream\" which supports Suspense on the server");
	}, e.renderToStaticNodeStream = function() {
		throw Error(n(208));
	}, e.renderToString = function(e, t) {
		return St(e, t, !1, "The server used \"renderToString\" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to \"renderToReadableStream\" which supports Suspense on the server");
	}, e.version = "18.3.1";
})), v = /* @__PURE__ */ e(((e) => {
	var t = g();
	function n(e) {
		for (var t = "https://reactjs.org/docs/error-decoder.html?invariant=" + e, n = 1; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	var r = null, i = 0;
	function a(e, t) {
		if (t.length !== 0) if (512 < t.length) 0 < i && (e.enqueue(new Uint8Array(r.buffer, 0, i)), r = new Uint8Array(512), i = 0), e.enqueue(t);
		else {
			var n = r.length - i;
			n < t.length && (n === 0 ? e.enqueue(r) : (r.set(t.subarray(0, n), i), e.enqueue(r), t = t.subarray(n)), r = new Uint8Array(512), i = 0), r.set(t, i), i += t.length;
		}
	}
	function o(e, t) {
		return a(e, t), !0;
	}
	function s(e) {
		r && 0 < i && (e.enqueue(new Uint8Array(r.buffer, 0, i)), r = null, i = 0);
	}
	var c = new TextEncoder();
	function l(e) {
		return c.encode(e);
	}
	function u(e) {
		return c.encode(e);
	}
	function d(e, t) {
		typeof e.error == "function" ? e.error(t) : e.close();
	}
	var f = Object.prototype.hasOwnProperty, p = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, m = {}, h = {};
	function _(e) {
		return f.call(h, e) ? !0 : f.call(m, e) ? !1 : p.test(e) ? h[e] = !0 : (m[e] = !0, !1);
	}
	function v(e, t, n, r, i, a, o) {
		this.acceptsBooleans = t === 2 || t === 3 || t === 4, this.attributeName = r, this.attributeNamespace = i, this.mustUseProperty = n, this.propertyName = e, this.type = t, this.sanitizeURL = a, this.removeEmptyString = o;
	}
	var y = {};
	"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(e) {
		y[e] = new v(e, 0, !1, e, null, !1, !1);
	}), [
		["acceptCharset", "accept-charset"],
		["className", "class"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"]
	].forEach(function(e) {
		var t = e[0];
		y[t] = new v(t, 1, !1, e[1], null, !1, !1);
	}), [
		"contentEditable",
		"draggable",
		"spellCheck",
		"value"
	].forEach(function(e) {
		y[e] = new v(e, 2, !1, e.toLowerCase(), null, !1, !1);
	}), [
		"autoReverse",
		"externalResourcesRequired",
		"focusable",
		"preserveAlpha"
	].forEach(function(e) {
		y[e] = new v(e, 2, !1, e, null, !1, !1);
	}), "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(e) {
		y[e] = new v(e, 3, !1, e.toLowerCase(), null, !1, !1);
	}), [
		"checked",
		"multiple",
		"muted",
		"selected"
	].forEach(function(e) {
		y[e] = new v(e, 3, !0, e, null, !1, !1);
	}), ["capture", "download"].forEach(function(e) {
		y[e] = new v(e, 4, !1, e, null, !1, !1);
	}), [
		"cols",
		"rows",
		"size",
		"span"
	].forEach(function(e) {
		y[e] = new v(e, 6, !1, e, null, !1, !1);
	}), ["rowSpan", "start"].forEach(function(e) {
		y[e] = new v(e, 5, !1, e.toLowerCase(), null, !1, !1);
	});
	var b = /[\-:]([a-z])/g;
	function x(e) {
		return e[1].toUpperCase();
	}
	"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(e) {
		var t = e.replace(b, x);
		y[t] = new v(t, 1, !1, e, null, !1, !1);
	}), "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(e) {
		var t = e.replace(b, x);
		y[t] = new v(t, 1, !1, e, "http://www.w3.org/1999/xlink", !1, !1);
	}), [
		"xml:base",
		"xml:lang",
		"xml:space"
	].forEach(function(e) {
		var t = e.replace(b, x);
		y[t] = new v(t, 1, !1, e, "http://www.w3.org/XML/1998/namespace", !1, !1);
	}), ["tabIndex", "crossOrigin"].forEach(function(e) {
		y[e] = new v(e, 1, !1, e.toLowerCase(), null, !1, !1);
	}), y.xlinkHref = new v("xlinkHref", 1, !1, "xlink:href", "http://www.w3.org/1999/xlink", !0, !1), [
		"src",
		"href",
		"action",
		"formAction"
	].forEach(function(e) {
		y[e] = new v(e, 1, !1, e.toLowerCase(), null, !0, !0);
	});
	var S = {
		animationIterationCount: !0,
		aspectRatio: !0,
		borderImageOutset: !0,
		borderImageSlice: !0,
		borderImageWidth: !0,
		boxFlex: !0,
		boxFlexGroup: !0,
		boxOrdinalGroup: !0,
		columnCount: !0,
		columns: !0,
		flex: !0,
		flexGrow: !0,
		flexPositive: !0,
		flexShrink: !0,
		flexNegative: !0,
		flexOrder: !0,
		gridArea: !0,
		gridRow: !0,
		gridRowEnd: !0,
		gridRowSpan: !0,
		gridRowStart: !0,
		gridColumn: !0,
		gridColumnEnd: !0,
		gridColumnSpan: !0,
		gridColumnStart: !0,
		fontWeight: !0,
		lineClamp: !0,
		lineHeight: !0,
		opacity: !0,
		order: !0,
		orphans: !0,
		tabSize: !0,
		widows: !0,
		zIndex: !0,
		zoom: !0,
		fillOpacity: !0,
		floodOpacity: !0,
		stopOpacity: !0,
		strokeDasharray: !0,
		strokeDashoffset: !0,
		strokeMiterlimit: !0,
		strokeOpacity: !0,
		strokeWidth: !0
	}, C = [
		"Webkit",
		"ms",
		"Moz",
		"O"
	];
	Object.keys(S).forEach(function(e) {
		C.forEach(function(t) {
			t = t + e.charAt(0).toUpperCase() + e.substring(1), S[t] = S[e];
		});
	});
	var w = /["'&<>]/;
	function T(e) {
		if (typeof e == "boolean" || typeof e == "number") return "" + e;
		e = "" + e;
		var t = w.exec(e);
		if (t) {
			var n = "", r, i = 0;
			for (r = t.index; r < e.length; r++) {
				switch (e.charCodeAt(r)) {
					case 34:
						t = "&quot;";
						break;
					case 38:
						t = "&amp;";
						break;
					case 39:
						t = "&#x27;";
						break;
					case 60:
						t = "&lt;";
						break;
					case 62:
						t = "&gt;";
						break;
					default: continue;
				}
				i !== r && (n += e.substring(i, r)), i = r + 1, n += t;
			}
			e = i === r ? n : n + e.substring(i, r);
		}
		return e;
	}
	var E = /([A-Z])/g, D = /^ms-/, O = Array.isArray, ee = u("<script>"), k = u("<\/script>"), te = u("<script src=\""), A = u("<script type=\"module\" src=\""), j = u("\" async=\"\"><\/script>"), M = /(<\/|<)(s)(cript)/gi;
	function ne(e, t, n, r) {
		return "" + t + (n === "s" ? "\\u0073" : "\\u0053") + r;
	}
	function N(e, t, n, r, i) {
		e = e === void 0 ? "" : e, t = t === void 0 ? ee : u("<script nonce=\"" + T(t) + "\">");
		var a = [];
		if (n !== void 0 && a.push(t, l(("" + n).replace(M, ne)), k), r !== void 0) for (n = 0; n < r.length; n++) a.push(te, l(T(r[n])), j);
		if (i !== void 0) for (r = 0; r < i.length; r++) a.push(A, l(T(i[r])), j);
		return {
			bootstrapChunks: a,
			startInlineScript: t,
			placeholderPrefix: u(e + "P:"),
			segmentPrefix: u(e + "S:"),
			boundaryPrefix: e + "B:",
			idPrefix: e,
			nextSuspenseID: 0,
			sentCompleteSegmentFunction: !1,
			sentCompleteBoundaryFunction: !1,
			sentClientRenderFunction: !1
		};
	}
	function P(e, t) {
		return {
			insertionMode: e,
			selectedValue: t
		};
	}
	function re(e) {
		return P(e === "http://www.w3.org/2000/svg" ? 2 : e === "http://www.w3.org/1998/Math/MathML" ? 3 : 0, null);
	}
	function ie(e, t, n) {
		switch (t) {
			case "select": return P(1, n.value == null ? n.defaultValue : n.value);
			case "svg": return P(2, null);
			case "math": return P(3, null);
			case "foreignObject": return P(1, null);
			case "table": return P(4, null);
			case "thead":
			case "tbody":
			case "tfoot": return P(5, null);
			case "colgroup": return P(7, null);
			case "tr": return P(6, null);
		}
		return 4 <= e.insertionMode || e.insertionMode === 0 ? P(1, null) : e;
	}
	var ae = u("<!-- -->");
	function oe(e, t, n, r) {
		return t === "" ? r : (r && e.push(ae), e.push(l(T(t))), !0);
	}
	var se = /* @__PURE__ */ new Map(), ce = u(" style=\""), le = u(":"), ue = u(";");
	function de(e, t, r) {
		if (typeof r != "object") throw Error(n(62));
		for (var i in t = !0, r) if (f.call(r, i)) {
			var a = r[i];
			if (a != null && typeof a != "boolean" && a !== "") {
				if (i.indexOf("--") === 0) {
					var o = l(T(i));
					a = l(T(("" + a).trim()));
				} else {
					o = i;
					var s = se.get(o);
					s === void 0 ? (s = u(T(o.replace(E, "-$1").toLowerCase().replace(D, "-ms-"))), se.set(o, s), o = s) : o = s, a = typeof a == "number" ? a === 0 || f.call(S, i) ? l("" + a) : l(a + "px") : l(T(("" + a).trim()));
				}
				t ? (t = !1, e.push(ce, o, le, a)) : e.push(ue, o, le, a);
			}
		}
		t || e.push(I);
	}
	var F = u(" "), fe = u("=\""), I = u("\""), pe = u("=\"\"");
	function L(e, t, n, r) {
		switch (n) {
			case "style":
				de(e, t, r);
				return;
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning": return;
		}
		if (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") {
			if (t = y.hasOwnProperty(n) ? y[n] : null, t !== null) {
				switch (typeof r) {
					case "function":
					case "symbol": return;
					case "boolean": if (!t.acceptsBooleans) return;
				}
				switch (n = l(t.attributeName), t.type) {
					case 3:
						r && e.push(F, n, pe);
						break;
					case 4:
						!0 === r ? e.push(F, n, pe) : !1 !== r && e.push(F, n, fe, l(T(r)), I);
						break;
					case 5:
						isNaN(r) || e.push(F, n, fe, l(T(r)), I);
						break;
					case 6:
						!isNaN(r) && 1 <= r && e.push(F, n, fe, l(T(r)), I);
						break;
					default: t.sanitizeURL && (r = "" + r), e.push(F, n, fe, l(T(r)), I);
				}
			} else if (_(n)) {
				switch (typeof r) {
					case "function":
					case "symbol": return;
					case "boolean": if (t = n.toLowerCase().slice(0, 5), t !== "data-" && t !== "aria-") return;
				}
				e.push(F, l(n), fe, l(T(r)), I);
			}
		}
	}
	var R = u(">"), me = u("/>");
	function he(e, t, r) {
		if (t != null) {
			if (r != null) throw Error(n(60));
			if (typeof t != "object" || !("__html" in t)) throw Error(n(61));
			t = t.__html, t != null && e.push(l("" + t));
		}
	}
	function ge(e) {
		var n = "";
		return t.Children.forEach(e, function(e) {
			e != null && (n += e);
		}), n;
	}
	var _e = u(" selected=\"\"");
	function ve(e, t, n, r) {
		e.push(B(n));
		var i = n = null, a;
		for (a in t) if (f.call(t, a)) {
			var o = t[a];
			if (o != null) switch (a) {
				case "children":
					n = o;
					break;
				case "dangerouslySetInnerHTML":
					i = o;
					break;
				default: L(e, r, a, o);
			}
		}
		return e.push(R), he(e, i, n), typeof n == "string" ? (e.push(l(T(n))), null) : n;
	}
	var z = u("\n"), ye = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/, be = /* @__PURE__ */ new Map();
	function B(e) {
		var t = be.get(e);
		if (t === void 0) {
			if (!ye.test(e)) throw Error(n(65, e));
			t = u("<" + e), be.set(e, t);
		}
		return t;
	}
	var xe = u("<!DOCTYPE html>");
	function Se(e, t, r, i, a) {
		switch (t) {
			case "select":
				e.push(B("select"));
				var o = null, s = null;
				for (p in r) if (f.call(r, p)) {
					var c = r[p];
					if (c != null) switch (p) {
						case "children":
							o = c;
							break;
						case "dangerouslySetInnerHTML":
							s = c;
							break;
						case "defaultValue":
						case "value": break;
						default: L(e, i, p, c);
					}
				}
				return e.push(R), he(e, s, o), o;
			case "option":
				s = a.selectedValue, e.push(B("option"));
				var u = c = null, d = null, p = null;
				for (o in r) if (f.call(r, o)) {
					var m = r[o];
					if (m != null) switch (o) {
						case "children":
							c = m;
							break;
						case "selected":
							d = m;
							break;
						case "dangerouslySetInnerHTML":
							p = m;
							break;
						case "value": u = m;
						default: L(e, i, o, m);
					}
				}
				if (s != null) if (r = u === null ? ge(c) : "" + u, O(s)) {
					for (i = 0; i < s.length; i++) if ("" + s[i] === r) {
						e.push(_e);
						break;
					}
				} else "" + s === r && e.push(_e);
				else d && e.push(_e);
				return e.push(R), he(e, p, c), c;
			case "textarea":
				for (c in e.push(B("textarea")), p = s = o = null, r) if (f.call(r, c) && (u = r[c], u != null)) switch (c) {
					case "children":
						p = u;
						break;
					case "value":
						o = u;
						break;
					case "defaultValue":
						s = u;
						break;
					case "dangerouslySetInnerHTML": throw Error(n(91));
					default: L(e, i, c, u);
				}
				if (o === null && s !== null && (o = s), e.push(R), p != null) {
					if (o != null) throw Error(n(92));
					if (O(p) && 1 < p.length) throw Error(n(93));
					o = "" + p;
				}
				return typeof o == "string" && o[0] === "\n" && e.push(z), o !== null && e.push(l(T("" + o))), null;
			case "input":
				for (s in e.push(B("input")), u = p = c = o = null, r) if (f.call(r, s) && (d = r[s], d != null)) switch (s) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(399, "input"));
					case "defaultChecked":
						u = d;
						break;
					case "defaultValue":
						c = d;
						break;
					case "checked":
						p = d;
						break;
					case "value":
						o = d;
						break;
					default: L(e, i, s, d);
				}
				return p === null ? u !== null && L(e, i, "checked", u) : L(e, i, "checked", p), o === null ? c !== null && L(e, i, "value", c) : L(e, i, "value", o), e.push(me), null;
			case "menuitem":
				for (var h in e.push(B("menuitem")), r) if (f.call(r, h) && (o = r[h], o != null)) switch (h) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(400));
					default: L(e, i, h, o);
				}
				return e.push(R), null;
			case "title":
				for (m in e.push(B("title")), o = null, r) if (f.call(r, m) && (s = r[m], s != null)) switch (m) {
					case "children":
						o = s;
						break;
					case "dangerouslySetInnerHTML": throw Error(n(434));
					default: L(e, i, m, s);
				}
				return e.push(R), o;
			case "listing":
			case "pre":
				for (u in e.push(B(t)), s = o = null, r) if (f.call(r, u) && (c = r[u], c != null)) switch (u) {
					case "children":
						o = c;
						break;
					case "dangerouslySetInnerHTML":
						s = c;
						break;
					default: L(e, i, u, c);
				}
				if (e.push(R), s != null) {
					if (o != null) throw Error(n(60));
					if (typeof s != "object" || !("__html" in s)) throw Error(n(61));
					r = s.__html, r != null && (typeof r == "string" && 0 < r.length && r[0] === "\n" ? e.push(z, l(r)) : e.push(l("" + r)));
				}
				return typeof o == "string" && o[0] === "\n" && e.push(z), o;
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "img":
			case "keygen":
			case "link":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
				for (var g in e.push(B(t)), r) if (f.call(r, g) && (o = r[g], o != null)) switch (g) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(n(399, t));
					default: L(e, i, g, o);
				}
				return e.push(me), null;
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return ve(e, r, t, i);
			case "html": return a.insertionMode === 0 && e.push(xe), ve(e, r, t, i);
			default:
				if (t.indexOf("-") === -1 && typeof r.is != "string") return ve(e, r, t, i);
				for (d in e.push(B(t)), s = o = null, r) if (f.call(r, d) && (c = r[d], c != null)) switch (d) {
					case "children":
						o = c;
						break;
					case "dangerouslySetInnerHTML":
						s = c;
						break;
					case "style":
						de(e, i, c);
						break;
					case "suppressContentEditableWarning":
					case "suppressHydrationWarning": break;
					default: _(d) && typeof c != "function" && typeof c != "symbol" && e.push(F, l(d), fe, l(T(c)), I);
				}
				return e.push(R), he(e, s, o), o;
		}
	}
	var Ce = u("</"), we = u(">"), Te = u("<template id=\""), Ee = u("\"></template>"), De = u("<!--$-->"), Oe = u("<!--$?--><template id=\""), ke = u("\"></template>"), V = u("<!--$!-->"), Ae = u("<!--/$-->"), H = u("<template"), je = u("\""), Me = u(" data-dgst=\"");
	u(" data-msg=\""), u(" data-stck=\"");
	var Ne = u("></template>");
	function U(e, t, r) {
		if (a(e, Oe), r === null) throw Error(n(395));
		return a(e, r), o(e, ke);
	}
	var Pe = u("<div hidden id=\""), Fe = u("\">"), W = u("</div>"), Ie = u("<svg aria-hidden=\"true\" style=\"display:none\" id=\""), Le = u("\">"), Re = u("</svg>"), ze = u("<math aria-hidden=\"true\" style=\"display:none\" id=\""), Be = u("\">"), Ve = u("</math>"), He = u("<table hidden id=\""), Ue = u("\">"), We = u("</table>"), Ge = u("<table hidden><tbody id=\""), Ke = u("\">"), qe = u("</tbody></table>"), Je = u("<table hidden><tr id=\""), Ye = u("\">"), Xe = u("</tr></table>"), Ze = u("<table hidden><colgroup id=\""), Qe = u("\">"), $e = u("</colgroup></table>");
	function et(e, t, r, i) {
		switch (r.insertionMode) {
			case 0:
			case 1: return a(e, Pe), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Fe);
			case 2: return a(e, Ie), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Le);
			case 3: return a(e, ze), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Be);
			case 4: return a(e, He), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Ue);
			case 5: return a(e, Ge), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Ke);
			case 6: return a(e, Je), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Ye);
			case 7: return a(e, Ze), a(e, t.segmentPrefix), a(e, l(i.toString(16))), o(e, Qe);
			default: throw Error(n(397));
		}
	}
	function tt(e, t) {
		switch (t.insertionMode) {
			case 0:
			case 1: return o(e, W);
			case 2: return o(e, Re);
			case 3: return o(e, Ve);
			case 4: return o(e, We);
			case 5: return o(e, qe);
			case 6: return o(e, Xe);
			case 7: return o(e, $e);
			default: throw Error(n(397));
		}
	}
	var nt = u("function $RS(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS(\""), rt = u("$RS(\""), it = u("\",\""), at = u("\")<\/script>"), ot = u("function $RC(a,b){a=document.getElementById(a);b=document.getElementById(b);b.parentNode.removeChild(b);if(a){a=a.previousSibling;var f=a.parentNode,c=a.nextSibling,e=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d)if(0===e)break;else e--;else\"$\"!==d&&\"$?\"!==d&&\"$!\"!==d||e++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;b.firstChild;)f.insertBefore(b.firstChild,c);a.data=\"$\";a._reactRetry&&a._reactRetry()}};$RC(\""), st = u("$RC(\""), ct = u("\",\""), lt = u("\")<\/script>"), ut = u("function $RX(b,c,d,e){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),b._reactRetry&&b._reactRetry())};$RX(\""), G = u("$RX(\""), dt = u("\""), ft = u(")<\/script>"), K = u(","), pt = /[<\u2028\u2029]/g;
	function mt(e) {
		return JSON.stringify(e).replace(pt, function(e) {
			switch (e) {
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	var q = Object.assign, ht = Symbol.for("react.element"), gt = Symbol.for("react.portal"), _t = Symbol.for("react.fragment"), J = Symbol.for("react.strict_mode"), Y = Symbol.for("react.profiler"), vt = Symbol.for("react.provider"), yt = Symbol.for("react.context"), bt = Symbol.for("react.forward_ref"), xt = Symbol.for("react.suspense"), St = Symbol.for("react.suspense_list"), Ct = Symbol.for("react.memo"), wt = Symbol.for("react.lazy"), Tt = Symbol.for("react.scope"), Et = Symbol.for("react.debug_trace_mode"), Dt = Symbol.for("react.legacy_hidden"), Ot = Symbol.for("react.default_value"), kt = Symbol.iterator;
	function At(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case _t: return "Fragment";
			case gt: return "Portal";
			case Y: return "Profiler";
			case J: return "StrictMode";
			case xt: return "Suspense";
			case St: return "SuspenseList";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case yt: return (e.displayName || "Context") + ".Consumer";
			case vt: return (e._context.displayName || "Context") + ".Provider";
			case bt:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case Ct: return t = e.displayName || null, t === null ? At(e.type) || "Memo" : t;
			case wt:
				t = e._payload, e = e._init;
				try {
					return At(e(t));
				} catch {}
		}
		return null;
	}
	var jt = {};
	function Mt(e, t) {
		if (e = e.contextTypes, !e) return jt;
		var n = {}, r;
		for (r in e) n[r] = t[r];
		return n;
	}
	var Nt = null;
	function X(e, t) {
		if (e !== t) {
			e.context._currentValue = e.parentValue, e = e.parent;
			var r = t.parent;
			if (e === null) {
				if (r !== null) throw Error(n(401));
			} else {
				if (r === null) throw Error(n(401));
				X(e, r);
			}
			t.context._currentValue = t.value;
		}
	}
	function Pt(e) {
		e.context._currentValue = e.parentValue, e = e.parent, e !== null && Pt(e);
	}
	function Ft(e) {
		var t = e.parent;
		t !== null && Ft(t), e.context._currentValue = e.value;
	}
	function Z(e, t) {
		if (e.context._currentValue = e.parentValue, e = e.parent, e === null) throw Error(n(402));
		e.depth === t.depth ? X(e, t) : Z(e, t);
	}
	function It(e, t) {
		var r = t.parent;
		if (r === null) throw Error(n(402));
		e.depth === r.depth ? X(e, r) : It(e, r), t.context._currentValue = t.value;
	}
	function Lt(e) {
		var t = Nt;
		t !== e && (t === null ? Ft(e) : e === null ? Pt(t) : t.depth === e.depth ? X(t, e) : t.depth > e.depth ? Z(t, e) : It(t, e), Nt = e);
	}
	var Rt = {
		isMounted: function() {
			return !1;
		},
		enqueueSetState: function(e, t) {
			e = e._reactInternals, e.queue !== null && e.queue.push(t);
		},
		enqueueReplaceState: function(e, t) {
			e = e._reactInternals, e.replace = !0, e.queue = [t];
		},
		enqueueForceUpdate: function() {}
	};
	function zt(e, t, n, r) {
		var i = e.state === void 0 ? null : e.state;
		e.updater = Rt, e.props = n, e.state = i;
		var a = {
			queue: [],
			replace: !1
		};
		e._reactInternals = a;
		var o = t.contextType;
		if (e.context = typeof o == "object" && o ? o._currentValue : r, o = t.getDerivedStateFromProps, typeof o == "function" && (o = o(n, i), i = o == null ? i : q({}, i, o), e.state = i), typeof t.getDerivedStateFromProps != "function" && typeof e.getSnapshotBeforeUpdate != "function" && (typeof e.UNSAFE_componentWillMount == "function" || typeof e.componentWillMount == "function")) if (t = e.state, typeof e.componentWillMount == "function" && e.componentWillMount(), typeof e.UNSAFE_componentWillMount == "function" && e.UNSAFE_componentWillMount(), t !== e.state && Rt.enqueueReplaceState(e, e.state, null), a.queue !== null && 0 < a.queue.length) if (t = a.queue, o = a.replace, a.queue = null, a.replace = !1, o && t.length === 1) e.state = t[0];
		else {
			for (a = o ? t[0] : e.state, i = !0, o = +!!o; o < t.length; o++) {
				var s = t[o];
				s = typeof s == "function" ? s.call(e, a, n, r) : s, s != null && (i ? (i = !1, a = q({}, a, s)) : q(a, s));
			}
			e.state = a;
		}
		else a.queue = null;
	}
	var Bt = {
		id: 1,
		overflow: ""
	};
	function Vt(e, t, n) {
		var r = e.id;
		e = e.overflow;
		var i = 32 - Ht(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - Ht(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			return a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, {
				id: 1 << 32 - Ht(t) + i | n << i | r,
				overflow: a + e
			};
		}
		return {
			id: 1 << a | n << i | r,
			overflow: e
		};
	}
	var Ht = Math.clz32 ? Math.clz32 : Gt, Ut = Math.log, Wt = Math.LN2;
	function Gt(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (Ut(e) / Wt | 0) | 0;
	}
	function Kt(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var qt = typeof Object.is == "function" ? Object.is : Kt, Jt = null, Yt = null, Xt = null, Q = null, Zt = !1, Qt = !1, $t = 0, en = null, tn = 0;
	function nn() {
		if (Jt === null) throw Error(n(321));
		return Jt;
	}
	function rn() {
		if (0 < tn) throw Error(n(312));
		return {
			memoizedState: null,
			queue: null,
			next: null
		};
	}
	function an() {
		return Q === null ? Xt === null ? (Zt = !1, Xt = Q = rn()) : (Zt = !0, Q = Xt) : Q.next === null ? (Zt = !1, Q = Q.next = rn()) : (Zt = !0, Q = Q.next), Q;
	}
	function on() {
		Yt = Jt = null, Qt = !1, Xt = null, tn = 0, Q = en = null;
	}
	function sn(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function cn(e, t, n) {
		if (Jt = nn(), Q = an(), Zt) {
			var r = Q.queue;
			if (t = r.dispatch, en !== null && (n = en.get(r), n !== void 0)) {
				en.delete(r), r = Q.memoizedState;
				do
					r = e(r, n.action), n = n.next;
				while (n !== null);
				return Q.memoizedState = r, [r, t];
			}
			return [Q.memoizedState, t];
		}
		return e = e === sn ? typeof t == "function" ? t() : t : n === void 0 ? t : n(t), Q.memoizedState = e, e = Q.queue = {
			last: null,
			dispatch: null
		}, e = e.dispatch = un.bind(null, Jt, e), [Q.memoizedState, e];
	}
	function ln(e, t) {
		if (Jt = nn(), Q = an(), t = t === void 0 ? null : t, Q !== null) {
			var n = Q.memoizedState;
			if (n !== null && t !== null) {
				var r = n[1];
				a: if (r === null) r = !1;
				else {
					for (var i = 0; i < r.length && i < t.length; i++) if (!qt(t[i], r[i])) {
						r = !1;
						break a;
					}
					r = !0;
				}
				if (r) return n[0];
			}
		}
		return e = e(), Q.memoizedState = [e, t], e;
	}
	function un(e, t, r) {
		if (25 <= tn) throw Error(n(301));
		if (e === Jt) if (Qt = !0, e = {
			action: r,
			next: null
		}, en === null && (en = /* @__PURE__ */ new Map()), r = en.get(t), r === void 0) en.set(t, e);
		else {
			for (t = r; t.next !== null;) t = t.next;
			t.next = e;
		}
	}
	function dn() {
		throw Error(n(394));
	}
	function fn() {}
	var pn = {
		readContext: function(e) {
			return e._currentValue;
		},
		useContext: function(e) {
			return nn(), e._currentValue;
		},
		useMemo: ln,
		useReducer: cn,
		useRef: function(e) {
			Jt = nn(), Q = an();
			var t = Q.memoizedState;
			return t === null ? (e = { current: e }, Q.memoizedState = e) : t;
		},
		useState: function(e) {
			return cn(sn, e);
		},
		useInsertionEffect: fn,
		useLayoutEffect: function() {},
		useCallback: function(e, t) {
			return ln(function() {
				return e;
			}, t);
		},
		useImperativeHandle: fn,
		useEffect: fn,
		useDebugValue: fn,
		useDeferredValue: function(e) {
			return nn(), e;
		},
		useTransition: function() {
			return nn(), [!1, dn];
		},
		useId: function() {
			var e = Yt.treeContext, t = e.overflow;
			e = e.id, e = (e & ~(1 << 32 - Ht(e) - 1)).toString(32) + t;
			var r = mn;
			if (r === null) throw Error(n(404));
			return t = $t++, e = ":" + r.idPrefix + "R" + e, 0 < t && (e += "H" + t.toString(32)), e + ":";
		},
		useMutableSource: function(e, t) {
			return nn(), t(e._source);
		},
		useSyncExternalStore: function(e, t, r) {
			if (r === void 0) throw Error(n(407));
			return r();
		}
	}, mn = null, hn = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
	function gn(e) {
		return console.error(e), null;
	}
	function _n() {}
	function vn(e, t, n, r, i, a, o, s, c) {
		var l = [], u = /* @__PURE__ */ new Set();
		return t = {
			destination: null,
			responseState: t,
			progressiveChunkSize: r === void 0 ? 12800 : r,
			status: 0,
			fatalError: null,
			nextSegmentId: 0,
			allPendingTasks: 0,
			pendingRootTasks: 0,
			completedRootSegment: null,
			abortableTasks: u,
			pingedTasks: l,
			clientRenderedBoundaries: [],
			completedBoundaries: [],
			partialBoundaries: [],
			onError: i === void 0 ? gn : i,
			onAllReady: a === void 0 ? _n : a,
			onShellReady: o === void 0 ? _n : o,
			onShellError: s === void 0 ? _n : s,
			onFatalError: c === void 0 ? _n : c
		}, n = bn(t, 0, null, n, !1, !1), n.parentFlushed = !0, e = yn(t, e, null, n, u, jt, null, Bt), l.push(e), t;
	}
	function yn(e, t, n, r, i, a, o, s) {
		e.allPendingTasks++, n === null ? e.pendingRootTasks++ : n.pendingTasks++;
		var c = {
			node: t,
			ping: function() {
				var t = e.pingedTasks;
				t.push(c), t.length === 1 && Nn(e);
			},
			blockedBoundary: n,
			blockedSegment: r,
			abortSet: i,
			legacyContext: a,
			context: o,
			treeContext: s
		};
		return i.add(c), c;
	}
	function bn(e, t, n, r, i, a) {
		return {
			status: 0,
			id: -1,
			index: t,
			parentFlushed: !1,
			chunks: [],
			children: [],
			formatContext: r,
			boundary: n,
			lastPushedText: i,
			textEmbedded: a
		};
	}
	function xn(e, t) {
		if (e = e.onError(t), e != null && typeof e != "string") throw Error("onError returned something with a type other than \"string\". onError should return a string and may return null or undefined but must not return anything else. It received something of type \"" + typeof e + "\" instead");
		return e;
	}
	function Sn(e, t) {
		var n = e.onShellError;
		n(t), n = e.onFatalError, n(t), e.destination === null ? (e.status = 1, e.fatalError = t) : (e.status = 2, d(e.destination, t));
	}
	function Cn(e, t, n, r, i) {
		for (Jt = {}, Yt = t, $t = 0, e = n(r, i); Qt;) Qt = !1, $t = 0, tn += 1, Q = null, e = n(r, i);
		return on(), e;
	}
	function wn(e, t, r, i) {
		var a = r.render(), o = i.childContextTypes;
		if (o != null) {
			var s = t.legacyContext;
			if (typeof r.getChildContext != "function") i = s;
			else {
				for (var c in r = r.getChildContext(), r) if (!(c in o)) throw Error(n(108, At(i) || "Unknown", c));
				i = q({}, s, r);
			}
			t.legacyContext = i, $(e, t, a), t.legacyContext = s;
		} else $(e, t, a);
	}
	function Tn(e, t) {
		if (e && e.defaultProps) {
			for (var n in t = q({}, t), e = e.defaultProps, e) t[n] === void 0 && (t[n] = e[n]);
			return t;
		}
		return t;
	}
	function En(e, t, r, i, a) {
		if (typeof r == "function") if (r.prototype && r.prototype.isReactComponent) {
			a = Mt(r, t.legacyContext);
			var o = r.contextType;
			o = new r(i, typeof o == "object" && o ? o._currentValue : a), zt(o, r, i, a), wn(e, t, o, r);
		} else {
			o = Mt(r, t.legacyContext), a = Cn(e, t, r, i, o);
			var s = $t !== 0;
			if (typeof a == "object" && a && typeof a.render == "function" && a.$$typeof === void 0) zt(a, r, i, o), wn(e, t, a, r);
			else if (s) {
				i = t.treeContext, t.treeContext = Vt(i, 1, 0);
				try {
					$(e, t, a);
				} finally {
					t.treeContext = i;
				}
			} else $(e, t, a);
		}
		else if (typeof r == "string") {
			switch (a = t.blockedSegment, o = Se(a.chunks, r, i, e.responseState, a.formatContext), a.lastPushedText = !1, s = a.formatContext, a.formatContext = ie(s, r, i), On(e, t, o), a.formatContext = s, r) {
				case "area":
				case "base":
				case "br":
				case "col":
				case "embed":
				case "hr":
				case "img":
				case "input":
				case "keygen":
				case "link":
				case "meta":
				case "param":
				case "source":
				case "track":
				case "wbr": break;
				default: a.chunks.push(Ce, l(r), we);
			}
			a.lastPushedText = !1;
		} else {
			switch (r) {
				case Dt:
				case Et:
				case J:
				case Y:
				case _t:
					$(e, t, i.children);
					return;
				case St:
					$(e, t, i.children);
					return;
				case Tt: throw Error(n(343));
				case xt:
					a: {
						r = t.blockedBoundary, a = t.blockedSegment, o = i.fallback, i = i.children, s = /* @__PURE__ */ new Set();
						var c = {
							id: null,
							rootSegmentID: -1,
							parentFlushed: !1,
							pendingTasks: 0,
							forceClientRender: !1,
							completedSegments: [],
							byteSize: 0,
							fallbackAbortableTasks: s,
							errorDigest: null
						}, u = bn(e, a.chunks.length, c, a.formatContext, !1, !1);
						a.children.push(u), a.lastPushedText = !1;
						var d = bn(e, 0, null, a.formatContext, !1, !1);
						d.parentFlushed = !0, t.blockedBoundary = c, t.blockedSegment = d;
						try {
							if (On(e, t, i), d.lastPushedText && d.textEmbedded && d.chunks.push(ae), d.status = 1, jn(c, d), c.pendingTasks === 0) break a;
						} catch (t) {
							d.status = 4, c.forceClientRender = !0, c.errorDigest = xn(e, t);
						} finally {
							t.blockedBoundary = r, t.blockedSegment = a;
						}
						t = yn(e, o, r, u, s, t.legacyContext, t.context, t.treeContext), e.pingedTasks.push(t);
					}
					return;
			}
			if (typeof r == "object" && r) switch (r.$$typeof) {
				case bt:
					if (i = Cn(e, t, r.render, i, a), $t !== 0) {
						r = t.treeContext, t.treeContext = Vt(r, 1, 0);
						try {
							$(e, t, i);
						} finally {
							t.treeContext = r;
						}
					} else $(e, t, i);
					return;
				case Ct:
					r = r.type, i = Tn(r, i), En(e, t, r, i, a);
					return;
				case vt:
					if (a = i.children, r = r._context, i = i.value, o = r._currentValue, r._currentValue = i, s = Nt, Nt = i = {
						parent: s,
						depth: s === null ? 0 : s.depth + 1,
						context: r,
						parentValue: o,
						value: i
					}, t.context = i, $(e, t, a), e = Nt, e === null) throw Error(n(403));
					i = e.parentValue, e.context._currentValue = i === Ot ? e.context._defaultValue : i, e = Nt = e.parent, t.context = e;
					return;
				case yt:
					i = i.children, i = i(r._currentValue), $(e, t, i);
					return;
				case wt:
					a = r._init, r = a(r._payload), i = Tn(r, i), En(e, t, r, i, void 0);
					return;
			}
			throw Error(n(130, r == null ? r : typeof r, ""));
		}
	}
	function $(e, t, r) {
		if (t.node = r, typeof r == "object" && r) {
			switch (r.$$typeof) {
				case ht:
					En(e, t, r.type, r.props, r.ref);
					return;
				case gt: throw Error(n(257));
				case wt:
					var i = r._init;
					r = i(r._payload), $(e, t, r);
					return;
			}
			if (O(r)) {
				Dn(e, t, r);
				return;
			}
			if (typeof r != "object" || !r ? i = null : (i = kt && r[kt] || r["@@iterator"], i = typeof i == "function" ? i : null), i &&= i.call(r)) {
				if (r = i.next(), !r.done) {
					var a = [];
					do
						a.push(r.value), r = i.next();
					while (!r.done);
					Dn(e, t, a);
				}
				return;
			}
			throw e = Object.prototype.toString.call(r), Error(n(31, e === "[object Object]" ? "object with keys {" + Object.keys(r).join(", ") + "}" : e));
		}
		typeof r == "string" ? (i = t.blockedSegment, i.lastPushedText = oe(t.blockedSegment.chunks, r, e.responseState, i.lastPushedText)) : typeof r == "number" && (i = t.blockedSegment, i.lastPushedText = oe(t.blockedSegment.chunks, "" + r, e.responseState, i.lastPushedText));
	}
	function Dn(e, t, n) {
		for (var r = n.length, i = 0; i < r; i++) {
			var a = t.treeContext;
			t.treeContext = Vt(a, r, i);
			try {
				On(e, t, n[i]);
			} finally {
				t.treeContext = a;
			}
		}
	}
	function On(e, t, n) {
		var r = t.blockedSegment.formatContext, i = t.legacyContext, a = t.context;
		try {
			return $(e, t, n);
		} catch (c) {
			if (on(), typeof c == "object" && c && typeof c.then == "function") {
				n = c;
				var o = t.blockedSegment, s = bn(e, o.chunks.length, null, o.formatContext, o.lastPushedText, !0);
				o.children.push(s), o.lastPushedText = !1, e = yn(e, t.node, t.blockedBoundary, s, t.abortSet, t.legacyContext, t.context, t.treeContext).ping, n.then(e, e), t.blockedSegment.formatContext = r, t.legacyContext = i, t.context = a, Lt(a);
			} else throw t.blockedSegment.formatContext = r, t.legacyContext = i, t.context = a, Lt(a), c;
		}
	}
	function kn(e) {
		var t = e.blockedBoundary;
		e = e.blockedSegment, e.status = 3, Mn(this, t, e);
	}
	function An(e, t, r) {
		var i = e.blockedBoundary;
		e.blockedSegment.status = 3, i === null ? (t.allPendingTasks--, t.status !== 2 && (t.status = 2, t.destination !== null && t.destination.close())) : (i.pendingTasks--, i.forceClientRender || (i.forceClientRender = !0, e = r === void 0 ? Error(n(432)) : r, i.errorDigest = t.onError(e), i.parentFlushed && t.clientRenderedBoundaries.push(i)), i.fallbackAbortableTasks.forEach(function(e) {
			return An(e, t, r);
		}), i.fallbackAbortableTasks.clear(), t.allPendingTasks--, t.allPendingTasks === 0 && (i = t.onAllReady, i()));
	}
	function jn(e, t) {
		if (t.chunks.length === 0 && t.children.length === 1 && t.children[0].boundary === null) {
			var n = t.children[0];
			n.id = t.id, n.parentFlushed = !0, n.status === 1 && jn(e, n);
		} else e.completedSegments.push(t);
	}
	function Mn(e, t, r) {
		if (t === null) {
			if (r.parentFlushed) {
				if (e.completedRootSegment !== null) throw Error(n(389));
				e.completedRootSegment = r;
			}
			e.pendingRootTasks--, e.pendingRootTasks === 0 && (e.onShellError = _n, t = e.onShellReady, t());
		} else t.pendingTasks--, t.forceClientRender || (t.pendingTasks === 0 ? (r.parentFlushed && r.status === 1 && jn(t, r), t.parentFlushed && e.completedBoundaries.push(t), t.fallbackAbortableTasks.forEach(kn, e), t.fallbackAbortableTasks.clear()) : r.parentFlushed && r.status === 1 && (jn(t, r), t.completedSegments.length === 1 && t.parentFlushed && e.partialBoundaries.push(t)));
		e.allPendingTasks--, e.allPendingTasks === 0 && (e = e.onAllReady, e());
	}
	function Nn(e) {
		if (e.status !== 2) {
			var t = Nt, n = hn.current;
			hn.current = pn;
			var r = mn;
			mn = e.responseState;
			try {
				var i = e.pingedTasks, a;
				for (a = 0; a < i.length; a++) {
					var o = i[a], s = e, c = o.blockedSegment;
					if (c.status === 0) {
						Lt(o.context);
						try {
							$(s, o, o.node), c.lastPushedText && c.textEmbedded && c.chunks.push(ae), o.abortSet.delete(o), c.status = 1, Mn(s, o.blockedBoundary, c);
						} catch (e) {
							if (on(), typeof e == "object" && e && typeof e.then == "function") {
								var l = o.ping;
								e.then(l, l);
							} else {
								o.abortSet.delete(o), c.status = 4;
								var u = o.blockedBoundary, d = e, f = xn(s, d);
								if (u === null ? Sn(s, d) : (u.pendingTasks--, u.forceClientRender || (u.forceClientRender = !0, u.errorDigest = f, u.parentFlushed && s.clientRenderedBoundaries.push(u))), s.allPendingTasks--, s.allPendingTasks === 0) {
									var p = s.onAllReady;
									p();
								}
							}
						}
					}
				}
				i.splice(0, a), e.destination !== null && zn(e, e.destination);
			} catch (t) {
				xn(e, t), Sn(e, t);
			} finally {
				mn = r, hn.current = n, n === pn && Lt(t);
			}
		}
	}
	function Pn(e, t, r) {
		switch (r.parentFlushed = !0, r.status) {
			case 0:
				var i = r.id = e.nextSegmentId++;
				return r.lastPushedText = !1, r.textEmbedded = !1, e = e.responseState, a(t, Te), a(t, e.placeholderPrefix), e = l(i.toString(16)), a(t, e), o(t, Ee);
			case 1:
				r.status = 2;
				var s = !0;
				i = r.chunks;
				var c = 0;
				r = r.children;
				for (var u = 0; u < r.length; u++) {
					for (s = r[u]; c < s.index; c++) a(t, i[c]);
					s = Fn(e, t, s);
				}
				for (; c < i.length - 1; c++) a(t, i[c]);
				return c < i.length && (s = o(t, i[c])), s;
			default: throw Error(n(390));
		}
	}
	function Fn(e, t, r) {
		var i = r.boundary;
		if (i === null) return Pn(e, t, r);
		if (i.parentFlushed = !0, i.forceClientRender) i = i.errorDigest, o(t, V), a(t, H), i && (a(t, Me), a(t, l(T(i))), a(t, je)), o(t, Ne), Pn(e, t, r);
		else if (0 < i.pendingTasks) {
			i.rootSegmentID = e.nextSegmentId++, 0 < i.completedSegments.length && e.partialBoundaries.push(i);
			var s = e.responseState, c = s.nextSuspenseID++;
			s = u(s.boundaryPrefix + c.toString(16)), i = i.id = s, U(t, e.responseState, i), Pn(e, t, r);
		} else if (i.byteSize > e.progressiveChunkSize) i.rootSegmentID = e.nextSegmentId++, e.completedBoundaries.push(i), U(t, e.responseState, i.id), Pn(e, t, r);
		else {
			if (o(t, De), r = i.completedSegments, r.length !== 1) throw Error(n(391));
			Fn(e, t, r[0]);
		}
		return o(t, Ae);
	}
	function In(e, t, n) {
		return et(t, e.responseState, n.formatContext, n.id), Fn(e, t, n), tt(t, n.formatContext);
	}
	function Ln(e, t, r) {
		for (var i = r.completedSegments, s = 0; s < i.length; s++) Rn(e, t, r, i[s]);
		if (i.length = 0, e = e.responseState, i = r.id, r = r.rootSegmentID, a(t, e.startInlineScript), e.sentCompleteBoundaryFunction ? a(t, st) : (e.sentCompleteBoundaryFunction = !0, a(t, ot)), i === null) throw Error(n(395));
		return r = l(r.toString(16)), a(t, i), a(t, ct), a(t, e.segmentPrefix), a(t, r), o(t, lt);
	}
	function Rn(e, t, r, i) {
		if (i.status === 2) return !0;
		var s = i.id;
		if (s === -1) {
			if ((i.id = r.rootSegmentID) === -1) throw Error(n(392));
			return In(e, t, i);
		}
		return In(e, t, i), e = e.responseState, a(t, e.startInlineScript), e.sentCompleteSegmentFunction ? a(t, rt) : (e.sentCompleteSegmentFunction = !0, a(t, nt)), a(t, e.segmentPrefix), s = l(s.toString(16)), a(t, s), a(t, it), a(t, e.placeholderPrefix), a(t, s), o(t, at);
	}
	function zn(e, t) {
		r = new Uint8Array(512), i = 0;
		try {
			var c = e.completedRootSegment;
			if (c !== null && e.pendingRootTasks === 0) {
				Fn(e, t, c), e.completedRootSegment = null;
				var u = e.responseState.bootstrapChunks;
				for (c = 0; c < u.length - 1; c++) a(t, u[c]);
				c < u.length && o(t, u[c]);
			}
			var d = e.clientRenderedBoundaries, f;
			for (f = 0; f < d.length; f++) {
				var p = d[f];
				u = t;
				var m = e.responseState, h = p.id, g = p.errorDigest, _ = p.errorMessage, v = p.errorComponentStack;
				if (a(u, m.startInlineScript), m.sentClientRenderFunction ? a(u, G) : (m.sentClientRenderFunction = !0, a(u, ut)), h === null) throw Error(n(395));
				if (a(u, h), a(u, dt), (g || _ || v) && (a(u, K), a(u, l(mt(g || "")))), (_ || v) && (a(u, K), a(u, l(mt(_ || "")))), v && (a(u, K), a(u, l(mt(v)))), !o(u, ft)) {
					e.destination = null, f++, d.splice(0, f);
					return;
				}
			}
			d.splice(0, f);
			var y = e.completedBoundaries;
			for (f = 0; f < y.length; f++) if (!Ln(e, t, y[f])) {
				e.destination = null, f++, y.splice(0, f);
				return;
			}
			y.splice(0, f), s(t), r = new Uint8Array(512), i = 0;
			var b = e.partialBoundaries;
			for (f = 0; f < b.length; f++) {
				var x = b[f];
				a: {
					d = e, p = t;
					var S = x.completedSegments;
					for (m = 0; m < S.length; m++) if (!Rn(d, p, x, S[m])) {
						m++, S.splice(0, m);
						var C = !1;
						break a;
					}
					S.splice(0, m), C = !0;
				}
				if (!C) {
					e.destination = null, f++, b.splice(0, f);
					return;
				}
			}
			b.splice(0, f);
			var w = e.completedBoundaries;
			for (f = 0; f < w.length; f++) if (!Ln(e, t, w[f])) {
				e.destination = null, f++, w.splice(0, f);
				return;
			}
			w.splice(0, f);
		} finally {
			s(t), e.allPendingTasks === 0 && e.pingedTasks.length === 0 && e.clientRenderedBoundaries.length === 0 && e.completedBoundaries.length === 0 && t.close();
		}
	}
	function Bn(e, t) {
		try {
			var n = e.abortableTasks;
			n.forEach(function(n) {
				return An(n, e, t);
			}), n.clear(), e.destination !== null && zn(e, e.destination);
		} catch (t) {
			xn(e, t), Sn(e, t);
		}
	}
	e.renderToReadableStream = function(e, t) {
		return new Promise(function(n, r) {
			var i, a, o = new Promise(function(e, t) {
				a = e, i = t;
			}), s = vn(e, N(t ? t.identifierPrefix : void 0, t ? t.nonce : void 0, t ? t.bootstrapScriptContent : void 0, t ? t.bootstrapScripts : void 0, t ? t.bootstrapModules : void 0), re(t ? t.namespaceURI : void 0), t ? t.progressiveChunkSize : void 0, t ? t.onError : void 0, a, function() {
				var e = new ReadableStream({
					type: "bytes",
					pull: function(e) {
						if (s.status === 1) s.status = 2, d(e, s.fatalError);
						else if (s.status !== 2 && s.destination === null) {
							s.destination = e;
							try {
								zn(s, e);
							} catch (e) {
								xn(s, e), Sn(s, e);
							}
						}
					},
					cancel: function() {
						Bn(s);
					}
				}, { highWaterMark: 0 });
				e.allReady = o, n(e);
			}, function(e) {
				o.catch(function() {}), r(e);
			}, i);
			if (t && t.signal) {
				var c = t.signal, l = function() {
					Bn(s, c.reason), c.removeEventListener("abort", l);
				};
				c.addEventListener("abort", l);
			}
			Nn(s);
		});
	}, e.version = "18.3.1";
})), y = /* @__PURE__ */ e(((e) => {
	var t = _(), n = v();
	e.version = t.version, e.renderToString = t.renderToString, e.renderToStaticMarkup = t.renderToStaticMarkup, e.renderToNodeStream = t.renderToNodeStream, e.renderToStaticNodeStream = t.renderToStaticNodeStream, e.renderToReadableStream = n.renderToReadableStream;
})), b = /* @__PURE__ */ e(((e) => {
	var t = g(), n = Symbol.for("react.element"), r = Symbol.for("react.fragment"), i = Object.prototype.hasOwnProperty, a = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, o = {
		key: !0,
		ref: !0,
		__self: !0,
		__source: !0
	};
	function s(e, t, r) {
		var s, c = {}, l = null, u = null;
		for (s in r !== void 0 && (l = "" + r), t.key !== void 0 && (l = "" + t.key), t.ref !== void 0 && (u = t.ref), t) i.call(t, s) && !o.hasOwnProperty(s) && (c[s] = t[s]);
		if (e && e.defaultProps) for (s in t = e.defaultProps, t) c[s] === void 0 && (c[s] = t[s]);
		return {
			$$typeof: n,
			type: e,
			key: l,
			ref: u,
			props: c,
			_owner: a.current
		};
	}
	e.Fragment = r, e.jsx = s, e.jsxs = s;
})), x = /* @__PURE__ */ e(((e, t) => {
	t.exports = b();
})), S = y(), C = x(), w = "Arial, Helvetica, sans-serif", T = "'Courier New', monospace", E = {
	welcome: [],
	auth: ["actionUrl"],
	security: [],
	daily_learning: ["course"],
	daily_games: ["games"],
	weekly_report: ["snapshot"],
	monthly_report: ["snapshot"],
	exam_reminder: ["exam"],
	inactivity: ["course"],
	essay: ["editorial"],
	product_update: ["editorial"],
	research: ["editorial"],
	marketing: ["editorial"],
	pulse: ["snapshot"],
	export_requested: [],
	export_ready: ["actionUrl"],
	deletion_requested: [],
	deletion_scheduled: ["date"],
	deletion_cancelled: [],
	deletion_completed: []
};
function D(e) {
	return E[e.type].every((t) => t === "snapshot" ? !!e.context.snapshot : t === "games" ? !!e.context.games?.length : t === "exam" ? !!e.context.exam : t === "course" ? !!e.context.course : !!e[t]);
}
function O({ value: e, label: t, color: n, border: r }) {
	return /* @__PURE__ */ (0, C.jsxs)("tr", { children: [/* @__PURE__ */ (0, C.jsx)("td", {
		style: {
			padding: "22px 14px",
			borderBottom: `1px solid ${r}`,
			fontSize: 36,
			lineHeight: "44px",
			letterSpacing: "-1.5px",
			color: n
		},
		children: e
	}), /* @__PURE__ */ (0, C.jsx)("td", {
		align: "right",
		style: {
			padding: "22px 14px",
			borderBottom: `1px solid ${r}`,
			fontFamily: T,
			fontSize: 11,
			letterSpacing: "1px"
		},
		children: t.toUpperCase()
	})] });
}
function ee({ href: e, children: t, background: n, foreground: r }) {
	return /* @__PURE__ */ (0, C.jsx)("table", {
		className: "email-cta",
		role: "presentation",
		cellPadding: 0,
		cellSpacing: 0,
		style: { margin: "32px 0" },
		children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: /* @__PURE__ */ (0, C.jsx)("tr", { children: /* @__PURE__ */ (0, C.jsx)("td", {
			style: {
				borderRadius: 28,
				msoPaddingAlt: "16px 24px"
			},
			children: /* @__PURE__ */ (0, C.jsxs)("a", {
				href: c(e),
				style: {
					display: "inline-block",
					padding: "17px 24px",
					color: r,
					background: n,
					boxShadow: "inset 0 1px 0 rgba(255,255,255,.28)",
					border: `1px solid ${n}`,
					borderRadius: 28,
					fontFamily: w,
					fontWeight: 700,
					fontSize: 13,
					textDecoration: "none"
				},
				children: [t, " \xA0 ↗"]
			})
		}) }) })
	});
}
function k({ src: e, large: t = !1 }) {
	let n = t ? 184 : 48;
	return /* @__PURE__ */ (0, C.jsx)("img", {
		src: c(e),
		width: n,
		height: n,
		alt: "AXOM Orb",
		style: {
			display: "block",
			border: 0,
			margin: t ? "24px auto 30px" : 0
		}
	});
}
function te(e) {
	let { type: t, context: n, baseUrl: r } = e, i = l(n.displayName), a = n.snapshot, o = a?.metrics.find((e) => e.id === "questions"), s = {
		welcome: `Welcome to AXOM${i === "there" ? "" : `, ${i}`}.`,
		auth: "Your secure way in.",
		security: "Your account, protected.",
		daily_learning: "A small place to begin.",
		daily_games: "Today’s cases are ready.",
		weekly_report: `Your week, ${i === "there" ? "measured" : i}.`,
		monthly_report: "A month in perspective.",
		exam_reminder: n.exam ? `${n.exam.days} days until ${n.exam.name}.` : "Your exam plan.",
		inactivity: "Your course is still here.",
		essay: e.editorial?.title ?? "A note from Jafar.",
		product_update: e.editorial?.title ?? "A little more possible.",
		research: e.editorial?.title ?? "Worth your attention.",
		marketing: e.editorial?.title ?? "An AXOM announcement.",
		pulse: `${i === "there" ? "This" : `${i}, this`} was your year.`,
		export_requested: "Your export is being prepared.",
		export_ready: "Your AXOM data is ready.",
		deletion_requested: "Your deletion request is recorded.",
		deletion_scheduled: "Your account deletion is scheduled.",
		deletion_cancelled: "Your account stays with you.",
		deletion_completed: "Your account has been deleted."
	}, c = {
		welcome: "A private workspace for the work of learning. Bring your courses, questions and attention together, one study day at a time.",
		auth: "Use this secure link to continue to your account. If you did not request it, you can ignore this email.",
		security: "Review your account and its connected devices if an activity looks unfamiliar.",
		daily_learning: `Continue with ${n.course ?? "your course"}. A short, deliberate review is a useful place to begin.`,
		daily_games: "A few minutes of diagnostic thinking. Choose a case when you have room for one.",
		weekly_report: "A record of your effort. A clearer view of what comes next.",
		monthly_report: "Patterns emerge with a little distance. Here is what your recorded activity shows.",
		exam_reminder: "Based on your recent AXOM activity, your exam plan can help you choose the next review. These records do not establish exam readiness.",
		inactivity: `When you are ready, return to ${n.course ?? "your course"}. Your place is waiting.`,
		essay: e.editorial?.excerpt ?? "",
		product_update: e.editorial?.excerpt ?? "",
		research: e.editorial?.excerpt ?? "",
		marketing: e.editorial?.excerpt ?? "",
		pulse: "Your year in medicine, measured.",
		export_requested: "We will email you when your account export is ready. Device-only source files remain on your device; download a local backup to preserve them separately.",
		export_ready: "Your export is available for seven days. Sign in to Privacy & Data to open a fresh, private download link. No data is attached to this email.",
		deletion_requested: "You can still download your account data. Check Privacy & Data for the scheduled date and cancellation options.",
		deletion_scheduled: `Deletion is scheduled for ${e.date ?? "the date shown in Privacy & Data"}. You can cancel before processing begins. Backup and security retention may follow separate policies; device-local files are not remotely erased.`,
		deletion_cancelled: "Your scheduled deletion has been cancelled. Your account and data remain available.",
		deletion_completed: "Your AXOM account and eligible linked records have been removed. Device-local copies remain under your control. Backup and required security retention follow the published policy."
	}, u = "Open AXOM", d = `${r}/#dashboard`;
	t === "welcome" && (u = "Enter AXOM"), t === "auth" && (u = "Continue securely", d = e.actionUrl ?? d), (t === "weekly_report" || t === "monthly_report") && (u = t === "weekly_report" ? "View full report" : "View monthly analysis", d = `${r}/#reports`), t === "pulse" && (u = "Open My Pulse", d = `${r}/pulse/${a?.periodStart.slice(0, 4) ?? (/* @__PURE__ */ new Date()).getUTCFullYear()}`), [
		"daily_learning",
		"inactivity",
		"exam_reminder"
	].includes(t) && (u = t === "exam_reminder" ? "Open Exam Plan" : "Continue your course", d = `${r}/#${t === "exam_reminder" ? n.exam?.route ?? "step" : "tracker"}`), e.editorial && (u = e.editorial.cta || "Read essay", d = e.editorial.url), (t.startsWith("deletion") || t.startsWith("export")) && (u = t === "export_ready" ? "Get my private download" : "Open Privacy & Data", d = e.actionUrl ?? `${r}/#privacy`);
	let f = e.editorial?.subject || (t === "weekly_report" && o ? `${i === "there" ? "You" : i}, ${o.value.toLocaleString("en")} questions this week.` : t === "pulse" ? `${i === "there" ? "Your" : `${i}, your`} AXOM Pulse is ready.` : s[t]);
	return {
		title: s[t],
		body: c[t],
		cta: u,
		href: d,
		subject: f
	};
}
function A(e) {
	if ([
		"essay",
		"product_update",
		"research",
		"marketing"
	].includes(e.type) || (e = {
		...e,
		editorial: void 0
	}), e.editorial) {
		let t = { ...e.editorial };
		for (let n of [
			"title",
			"excerpt",
			"subject",
			"preview",
			"cta"
		]) t[n] && (t[n] = u(t[n], e.context));
		e = {
			...e,
			editorial: t
		};
	}
	let { context: i, type: a } = e, o = n[a], l = te(e), d = i.theme === "dark", f = d ? "#0d0d0e" : "#f4f1eb", p = d ? "#161618" : "#fffdf9", m = d ? "#e6e2d6" : "#242322", h = d ? "#b2afa8" : "#65605a", g = d ? "#353438" : "#d9d4ca", _ = s(i.accent), v = i.snapshot, y = a === "pulse", b = v?.metrics.filter((e) => [
		"questions",
		"accuracy",
		"minutes",
		"days",
		"reviews"
	].includes(e.id)) ?? [], x = v?.systems.filter((e) => (e.delta ?? 0) > 0).sort((e, t) => (t.delta ?? 0) - (e.delta ?? 0))[0], E = [
		"weekly_report",
		"monthly_report",
		"pulse"
	].includes(a), D = [
		"essay",
		"product_update",
		"research",
		"marketing"
	].includes(a), A = y ? "pulse" : E ? "report" : D ? "editorial" : "account", j = d ? "#1b1e24" : "#ffffff", M = d ? "#55565a" : "#ffffff", ne = y ? `PULSE // ${v?.periodStart.slice(0, 4) ?? "YEAR"}` : r(o) ? t[o].label.toUpperCase() : "YOUR AXOM ACCOUNT", N = b.map((e) => `${e.value.toLocaleString("en")} ${e.unit} ${e.label}`), P = "<!doctype html>" + (0, S.renderToStaticMarkup)(/* @__PURE__ */ (0, C.jsxs)("html", {
		lang: "en",
		children: [/* @__PURE__ */ (0, C.jsxs)("head", { children: [
			/* @__PURE__ */ (0, C.jsx)("meta", { charSet: "utf-8" }),
			/* @__PURE__ */ (0, C.jsx)("meta", {
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			}),
			/* @__PURE__ */ (0, C.jsx)("meta", {
				name: "color-scheme",
				content: "light dark"
			}),
			/* @__PURE__ */ (0, C.jsx)("title", { children: l.subject }),
			/* @__PURE__ */ (0, C.jsx)("style", { dangerouslySetInnerHTML: { __html: "\n.email-masthead{position:relative;overflow:hidden}\n@media(prefers-reduced-motion:no-preference){.email-masthead:after{content:\"\";position:absolute;pointer-events:none;inset:-50% auto -50% -55%;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.16),transparent);opacity:0;animation:email-luster 2.4s cubic-bezier(.22,1,.36,1) .6s 1}@keyframes email-luster{0%{transform:translateX(-100%) rotate(17deg);opacity:0}15%{opacity:.8}100%{transform:translateX(460%) rotate(17deg);opacity:0}}}\n@media(max-width:600px){.email-pad{padding:28px 22px!important}.email-title{font-size:34px!important;line-height:39px!important}.email-masthead{padding:22px!important}.email-shell{border-radius:24px!important}}\n" } })
		] }), /* @__PURE__ */ (0, C.jsxs)("body", {
			className: `email-family-${A}`,
			style: {
				margin: 0,
				padding: 0,
				backgroundColor: f,
				color: m,
				fontFamily: w
			},
			children: [/* @__PURE__ */ (0, C.jsx)("div", {
				style: {
					display: "none",
					maxHeight: 0,
					overflow: "hidden",
					opacity: 0
				},
				children: e.editorial?.preview || l.body
			}), /* @__PURE__ */ (0, C.jsx)("table", {
				role: "presentation",
				width: "100%",
				cellPadding: 0,
				cellSpacing: 0,
				bgcolor: f,
				children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: /* @__PURE__ */ (0, C.jsx)("tr", { children: /* @__PURE__ */ (0, C.jsx)("td", {
					align: "center",
					style: { padding: "28px 12px" },
					children: /* @__PURE__ */ (0, C.jsx)("table", {
						className: "email-shell",
						role: "presentation",
						width: "600",
						cellPadding: 0,
						cellSpacing: 0,
						style: {
							width: "100%",
							maxWidth: 600,
							backgroundColor: p,
							backgroundImage: `linear-gradient(145deg,${j},${p} 48%)`,
							border: `1px solid ${g}`,
							borderTopColor: M,
							borderRadius: 32,
							boxShadow: `inset 0 1px 0 ${M}, 0 24px 70px rgba(0,0,0,.12)`
						},
						children: /* @__PURE__ */ (0, C.jsxs)("tbody", { children: [/* @__PURE__ */ (0, C.jsx)("tr", { children: /* @__PURE__ */ (0, C.jsx)("td", {
							className: "email-pad",
							style: { padding: "12px 12px 0" },
							children: /* @__PURE__ */ (0, C.jsxs)("div", {
								className: "email-masthead",
								style: {
									padding: "28px 32px",
									backgroundColor: j,
									backgroundImage: `linear-gradient(125deg,${_}24,${j} 48%,${_}0a)`,
									border: `1px solid ${g}`,
									borderTopColor: M,
									borderRadius: 22,
									boxShadow: `inset 0 1px 0 ${M}`
								},
								children: [/* @__PURE__ */ (0, C.jsx)("table", {
									role: "presentation",
									width: "100%",
									cellPadding: 0,
									cellSpacing: 0,
									children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: /* @__PURE__ */ (0, C.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, C.jsx)("td", {
											width: "64",
											children: /* @__PURE__ */ (0, C.jsx)(k, { src: i.orbUrl })
										}),
										/* @__PURE__ */ (0, C.jsxs)("td", {
											style: {
												fontSize: 13,
												letterSpacing: "4px",
												fontWeight: 700,
												color: m
											},
											children: [
												"AXOM",
												/* @__PURE__ */ (0, C.jsx)("br", {}),
												/* @__PURE__ */ (0, C.jsx)("span", {
													style: {
														font: `9px ${T}`,
														letterSpacing: "1px",
														color: h
													},
													children: D ? "ESSAYS & IDEAS" : y ? "YOUR PRIVATE RECORD" : E ? "THE WORK, RECORDED" : "A SPACE OF YOUR OWN"
												})
											]
										}),
										/* @__PURE__ */ (0, C.jsx)("td", {
											align: "right",
											style: {
												color: h,
												font: `10px ${T}`
											},
											children: y ? v?.periodStart.slice(0, 4) ?? "PULSE" : "//"
										})
									] }) })
								}), y && /* @__PURE__ */ (0, C.jsx)(k, {
									src: i.orbUrl,
									large: !0
								})]
							})
						}) }), /* @__PURE__ */ (0, C.jsx)("tr", { children: /* @__PURE__ */ (0, C.jsxs)("td", {
							className: "email-pad",
							style: { padding: "36px 44px 40px" },
							children: [
								/* @__PURE__ */ (0, C.jsx)("p", {
									style: {
										color: h,
										font: `11px ${T}`,
										letterSpacing: "2px",
										margin: "0 0 22px",
										borderLeft: `2px solid ${_}`,
										paddingLeft: 12
									},
									children: ne
								}),
								/* @__PURE__ */ (0, C.jsx)("h1", {
									className: "email-title",
									style: {
										fontFamily: D ? "Georgia, Times, serif" : w,
										fontSize: y ? 46 : D ? 42 : 38,
										fontWeight: 400,
										letterSpacing: D ? "-1.2px" : "-1.7px",
										lineHeight: y ? "50px" : "46px",
										margin: "0 0 24px",
										color: m
									},
									children: l.title
								}),
								/* @__PURE__ */ (0, C.jsx)("p", {
									style: {
										color: h,
										fontSize: D ? 16 : 15,
										lineHeight: "27px",
										margin: "0 0 28px"
									},
									children: l.body
								}),
								a === "auth" && /* @__PURE__ */ (0, C.jsx)("div", { id: "axom-auth-code" }),
								E && /* @__PURE__ */ (0, C.jsxs)(C.Fragment, { children: [
									/* @__PURE__ */ (0, C.jsxs)("p", {
										style: {
											font: `11px ${T}`,
											color: h
										},
										children: [
											v?.periodStart,
											" · ",
											v?.periodEnd
										]
									}),
									/* @__PURE__ */ (0, C.jsx)("table", {
										role: "presentation",
										width: "100%",
										cellPadding: 0,
										cellSpacing: 0,
										style: {
											backgroundColor: j,
											border: `1px solid ${g}`,
											borderRadius: 16,
											boxShadow: `inset 0 1px 0 ${M}`
										},
										children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: b.map((e) => /* @__PURE__ */ (0, C.jsx)(O, {
											color: m,
											border: g,
											label: e.label,
											value: e.id === "minutes" ? `${Math.round(e.value / 60 * 10) / 10}h` : `${e.value.toLocaleString("en")}${e.unit}`
										}, e.id)) })
									}),
									!b.length && /* @__PURE__ */ (0, C.jsx)("p", {
										style: {
											color: h,
											fontSize: 15,
											lineHeight: "24px"
										},
										children: "Your record is beginning. There is not enough recorded activity for a report yet."
									}),
									v?.comparison?.accuracyDelta !== void 0 && /* @__PURE__ */ (0, C.jsxs)("p", {
										style: {
											fontSize: 13,
											lineHeight: "22px",
											color: h
										},
										children: [
											"Recorded accuracy ",
											v.comparison.accuracyDelta >= 0 ? "increased" : "decreased",
											" ",
											Math.abs(v.comparison.accuracyDelta),
											" percentage points versus the previous equal-length period."
										]
									}),
									v && v.systems.length > 1 && /* @__PURE__ */ (0, C.jsxs)("p", {
										style: {
											fontSize: 13,
											lineHeight: "22px",
											color: h
										},
										children: [
											"Strongest recorded system: ",
											v.systems[0].name,
											". A direction for review: ",
											v.systems.at(-1)?.name,
											"."
										]
									}),
									x && /* @__PURE__ */ (0, C.jsxs)("div", {
										style: {
											borderLeft: `3px solid ${_}`,
											padding: "4px 0 4px 18px",
											marginTop: 28
										},
										children: [
											/* @__PURE__ */ (0, C.jsx)("p", {
												style: {
													color: h,
													font: `10px ${T}`,
													letterSpacing: "1px"
												},
												children: "MOST IMPROVED SYSTEM"
											}),
											/* @__PURE__ */ (0, C.jsxs)("h2", {
												style: {
													fontSize: 24,
													fontWeight: 400
												},
												children: [
													x.name,
													" +",
													x.delta,
													" points"
												]
											}),
											/* @__PURE__ */ (0, C.jsx)("p", {
												style: {
													color: h,
													fontSize: 13,
													lineHeight: "22px"
												},
												children: "First-answer accuracy improved between the two halves of this period."
											})
										]
									}),
									a === "monthly_report" && v?.trend.length ? /* @__PURE__ */ (0, C.jsx)("table", {
										role: "presentation",
										width: "100%",
										style: { marginTop: 26 },
										children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: v.trend.slice(-8).map((e) => /* @__PURE__ */ (0, C.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, C.jsx)("td", {
												style: {
													color: h,
													fontSize: 11
												},
												children: e.label
											}),
											/* @__PURE__ */ (0, C.jsx)("td", {
												style: { padding: "6px 0" },
												children: /* @__PURE__ */ (0, C.jsx)("table", {
													role: "presentation",
													width: `${e.accuracy ?? 0}%`,
													bgcolor: _,
													children: /* @__PURE__ */ (0, C.jsx)("tbody", { children: /* @__PURE__ */ (0, C.jsx)("tr", { children: /* @__PURE__ */ (0, C.jsx)("td", { height: "5" }) }) })
												})
											}),
											/* @__PURE__ */ (0, C.jsx)("td", {
												align: "right",
												style: { fontSize: 12 },
												children: e.accuracy === null ? "No score" : `${e.accuracy}%`
											})
										] }, e.label)) })
									}) : null
								] }),
								a === "daily_games" && i.games?.map((e) => /* @__PURE__ */ (0, C.jsxs)("div", {
									style: {
										borderTop: `1px solid ${g}`,
										padding: "20px 0"
									},
									children: [
										/* @__PURE__ */ (0, C.jsx)("h2", {
											style: {
												fontSize: 20,
												fontWeight: 400
											},
											children: e.name
										}),
										/* @__PURE__ */ (0, C.jsx)("p", {
											style: {
												color: h,
												fontSize: 13
											},
											children: e.detail
										}),
										/* @__PURE__ */ (0, C.jsxs)("a", {
											href: c(e.url),
											style: {
												color: m,
												fontSize: 13
											},
											children: [
												"Open ",
												e.name,
												" ↗"
											]
										})
									]
								}, e.name)),
								e.editorial?.imageUrl && /* @__PURE__ */ (0, C.jsx)("img", {
									src: c(e.editorial.imageUrl),
									alt: "Essay illustration",
									width: "504",
									height: "252",
									style: {
										width: "100%",
										height: "auto",
										display: "block"
									}
								}),
								e.editorial?.readingMinutes && /* @__PURE__ */ (0, C.jsxs)("p", {
									style: {
										font: `11px ${T}`,
										color: h
									},
									children: [e.editorial.readingMinutes, " MIN READ · JAFAR FROM AXOM"]
								}),
								a !== "deletion_completed" && /* @__PURE__ */ (0, C.jsx)(ee, {
									href: l.href,
									background: m,
									foreground: p,
									children: l.cta
								}),
								E && /* @__PURE__ */ (0, C.jsxs)("p", {
									style: {
										fontSize: 11,
										lineHeight: "18px",
										color: h
									},
									children: [v?.source === "protected-copy" ? `Protected copy: ${v.sourceUpdatedAt ?? "date unavailable"}. Device-only changes are not included. ` : "", "Statistics describe recorded activity, including repeat answers. Open the report for sources and denominators."]
								}),
								/* @__PURE__ */ (0, C.jsxs)("div", {
									style: {
										borderTop: `1px solid ${g}`,
										marginTop: 40,
										paddingTop: 22
									},
									children: [/* @__PURE__ */ (0, C.jsx)("p", {
										style: {
											color: h,
											fontSize: 11,
											lineHeight: "19px"
										},
										children: r(o) ? `You chose ${t[o].label}.` : "An essential AXOM account communication."
									}), /* @__PURE__ */ (0, C.jsxs)("p", {
										style: {
											color: h,
											fontSize: 11,
											lineHeight: "22px"
										},
										children: [r(o) && /* @__PURE__ */ (0, C.jsxs)(C.Fragment, { children: [
											/* @__PURE__ */ (0, C.jsx)("a", {
												href: c(`${e.baseUrl}/#communications`),
												style: { color: h },
												children: "Manage preferences"
											}),
											" · ",
											/* @__PURE__ */ (0, C.jsx)("a", {
												href: c(e.unsubscribeUrl ?? `${e.baseUrl}/#communications`),
												style: { color: h },
												children: "Unsubscribe"
											}),
											" · "
										] }), /* @__PURE__ */ (0, C.jsx)("a", {
											href: c(`${e.baseUrl}/#privacy`),
											style: { color: h },
											children: "Privacy & Data"
										})]
									})]
								})
							]
						}) })] })
					})
				}) }) })
			})]
		})]
	}));
	return {
		subject: l.subject,
		category: o,
		html: P,
		text: [
			"AXOM",
			ne,
			l.title,
			l.body,
			...E ? N : [],
			...a === "daily_games" ? i.games?.map((e) => `${e.name}: ${e.detail}\n${c(e.url)}`) ?? [] : [],
			`${l.cta}: ${c(l.href)}`,
			...r(o) ? [`Manage preferences: ${c(`${e.baseUrl}/#communications`)}`, `Unsubscribe: ${c(e.unsubscribeUrl ?? `${e.baseUrl}/#communications`)}`] : []
		].join("\n\n")
	};
}
//#endregion
//#region web/src/lib/scoring.ts
function j(e) {
	return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
}
//#endregion
//#region web/src/lib/dailyRollover.ts
function M(e = /* @__PURE__ */ new Date()) {
	return j(e);
}
function ne(e) {
	let [t, n, r] = e.split("-").map(Number);
	return new Date(t, n - 1, r, 12, 0, 0, 0);
}
function N(e, t) {
	let n = ne(e);
	return n.setDate(n.getDate() + t), M(n);
}
function P(e, t) {
	let n = ne(e).getTime(), r = ne(t).getTime();
	return !Number.isFinite(n) || !Number.isFinite(r) ? 0 : Math.max(0, Math.round((r - n) / 864e5));
}
//#endregion
//#region web/src/lib/examPlan.ts
var re = {
	step1: {
		label: "USMLE Step 1",
		short: "Step 1",
		maxTier: 150,
		route: "step"
	},
	step2: {
		label: "USMLE Step 2 CK",
		short: "Step 2 CK",
		maxTier: 200,
		route: "step2"
	},
	step3: {
		label: "USMLE Step 3",
		short: "Step 3",
		maxTier: 150,
		route: "step3"
	},
	shelf: {
		label: "Shelf exam",
		short: "Shelf",
		maxTier: 100,
		route: "shelf"
	},
	mcat: {
		label: "MCAT",
		short: "MCAT",
		maxTier: 100,
		route: "mcat"
	},
	premed: {
		label: "Pre-Med study",
		short: "Pre-Med",
		maxTier: 60,
		route: "premed"
	}
};
function ie(e, t = M()) {
	if (!e) return null;
	let n = e.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return null;
	let r = P(t, n);
	if (r > 0) return r;
	let i = P(n, t);
	return i > 0 ? -i : 0;
}
var ae = {
	"not-started": 0,
	light: 1,
	half: 2,
	most: 3,
	dedicated: 4
};
function oe(e, t = M()) {
	if (!e) return null;
	let n = Object.entries(e).filter(([, e]) => e);
	if (!n.length) return null;
	let r = n.map(([e, n]) => ({
		id: e,
		days: ie(n.examDate, t)
	})).filter((e) => e.days !== null), i = r.filter((e) => e.days >= 0).sort((e, t) => e.days - t.days);
	if (i.length) return i[0].id;
	let a = r.filter((e) => e.days < 0).sort((e, t) => t.days - e.days);
	if (a.length) return a[0].id;
	let o = n.map(([e, t]) => ({
		id: e,
		rank: ae[t.contentStarted] ?? 0
	})).sort((e, t) => t.rank - e.rank);
	return o[0].rank > 0 ? o[0].id : null;
}
//#endregion
//#region web/src/lib/communications/context.ts
function se(e, t) {
	let n = oe(e.boardPrep, t);
	if (!n) return;
	let r = e.boardPrep?.[n]?.examDate, i = ie(r, t);
	if (!(!r || i === null || i < 0)) return {
		name: re[n].label,
		date: r,
		days: i,
		route: re[n].route
	};
}
new Set([
	"yellow",
	"cyan",
	"purple",
	"red",
	"green"
]);
//#endregion
//#region web/src/lib/brand.ts
var ce = {
	name: "axom-web",
	private: !0,
	version: "0.0.2-prebeta",
	type: "module",
	description: "AXOM — a premium, local-first medical-school command center, as a deployable web app.",
	scripts: {
		dev: "vite",
		typecheck: "tsc -b",
		lint: "eslint .",
		test: "vitest run",
		"test:e2e": "playwright test",
		"test:watch": "vitest",
		"test:coverage": "vitest run --coverage",
		build: "tsc -b && vite build && node scripts/verify-daily-games-bundle.mjs",
		"verify:daily-games-bundle": "node scripts/verify-daily-games-bundle.mjs",
		"verify:daily-games-offline": "node scripts/verify-daily-games-offline.mjs",
		"verify:question-imports": "vitest run src/lib/questionImportEvaluation.test.ts --reporter=verbose",
		preview: "vite preview",
		package: "node ../scripts/release.mjs --web-only",
		release: "node ../scripts/release.mjs",
		"release:web": "node ../scripts/release.mjs --web-only",
		"release:doctor": "node ../scripts/release.mjs --doctor",
		"release:version": "node ../scripts/release.mjs --version",
		"test:release": "node --test ../scripts/*.test.mjs",
		"verify:app-updates": "node scripts/verify-app-updates.mjs",
		tauri: "node ../scripts/tauri.mjs",
		quality: "npm run typecheck && npm run lint && npm run test && npm run build",
		"verify:all": "node ../scripts/repository-hygiene.mjs && npm run quality && npm run verify:app-updates && npm run verify:daily-games-offline && npm run test:e2e",
		snapshots: "node scripts/visual-snapshots.mjs",
		"test:e2e:chrome": "AXOM_E2E_CHANNEL=chrome playwright test",
		"test:accounts:live": "AXOM_LIVE_ACCOUNTS=1 AXOM_E2E_CHANNEL=chrome playwright test e2e/live-accounts.spec.ts",
		"release:setup-updater": "node ../scripts/setup-updater.mjs",
		"cinematic:import": "node ../scripts/import-cinematic.mjs",
		"soundscapes:import": "node ../scripts/import-soundscapes.mjs",
		"media:audit": "node --import tsx ./scripts/media-audit.ts",
		"sources:inventory": "node --experimental-strip-types ./scripts/source-inventory.ts"
	},
	engines: {
		node: ">=22.23.1 <23",
		npm: "10.9.8"
	},
	dependencies: {
		"@noble/hashes": "^2.4.0",
		"@supabase/supabase-js": "^2.112.2",
		"@tauri-apps/api": "^2.11.1",
		"@tauri-apps/plugin-notification": "^2.5.0",
		"@tauri-apps/plugin-process": "^2.3.1",
		"@tauri-apps/plugin-sql": "^2.4.0",
		"@tauri-apps/plugin-updater": "^2.12.0",
		"@vercel/analytics": "^2.0.1",
		"@vercel/speed-insights": "^2.0.0",
		"lucide-react": "^0.460.0",
		mammoth: "^1.12.0",
		"pdfjs-dist": "^6.2.108",
		react: "^18.3.1",
		"react-dom": "^18.3.1",
		"tus-js-client": "4.3.1",
		"xlsx-js-style": "^1.2.0",
		zustand: "^5.0.1"
	},
	devDependencies: {
		"@electric-sql/pglite": "^0.5.8",
		"@eslint/js": "^10.0.1",
		"@playwright/test": "^1.61.0",
		"@tauri-apps/cli": "^2.11.5",
		"@testing-library/jest-dom": "^6.9.1",
		"@testing-library/react": "^16.3.2",
		"@testing-library/user-event": "^14.6.1",
		"@types/node": "^22.20.4",
		"@types/react": "^18.3.12",
		"@types/react-dom": "^18.3.1",
		"@vitejs/plugin-react": "^6.0.2",
		"@vitest/coverage-v8": "^4.1.11",
		eslint: "^10.5.0",
		"eslint-plugin-react-hooks": "^7.1.1",
		"fake-indexeddb": "^6.2.4",
		jsdom: "^29.1.1",
		jszip: "^3.10.1",
		typescript: "^5.9.3",
		"typescript-eslint": "^8.62.0",
		vite: "^8.0.16",
		vitest: "^4.1.11"
	},
	packageManager: "npm@10.9.8"
}.version, le = {
	productName: "AXOM",
	tagline: "Private academic operating system",
	productKind: "private academic operating system",
	channel: "pre-beta",
	hostedUrl: "https://noctyrium-cktjdhuhw-jacloses-projects.vercel.app/#dashboard",
	changelogRoute: "about"
}, ue = {
	vaultDb: "noctyrium-local-vault",
	persistedState: "noctyrium-state",
	pomodoroSession: "noctyrium-pomodoro-session",
	activeStudySession: "noctyrium-active-session",
	aiSettings: "noctyrium-ai-settings",
	lastBackupAt: "noctyrium-last-backup-at",
	preMigrationSnapshot: "noctyrium-premigration-snapshot",
	updateDeferredVersion: "noctyrium-update-deferred",
	storageSchemaVersion: "axom.storage.schemaVersion",
	lastSeenBuild: "axom.lastSeenBuild",
	themePreference: "axom.theme",
	dismissedAnnouncements: "axom.announcements.dismissed.v1",
	palettePreference: "axom.palette.v1",
	motionPreference: "axom.motion",
	focusCheckIns: "axom.focus-checkins.v1",
	focusCheckInPending: "axom.focus-checkins.pending.v1",
	restoreHistory: "axom.restore-history.v1",
	lastVaultWriteAt: "axom.vault.last-write-at",
	quotePreferences: "axom.quotes.preferences.v1",
	quizReadingScale: "axom.quiz.reading-scale.v1",
	quizActiveSession: "axom.quiz.active-session.v1",
	quizTutorTips: "axom.quiz.tutor-tips.v1",
	missedStandupReminder: "noctyrium-missed-standup-alert",
	dailyLoopReminders: "axom.daily-loop.reminders.v1",
	localBackupPrefix: "axom.backups.local.",
	aiGenerations: "axom.ai.generations",
	migrationFailure: "axom.storage.migrationFailure"
}, de = ce;
`${le.productName}${de}`, typeof window < "u" && "__TAURI_INTERNALS__" in window, ue.vaultDb;
//#endregion
//#region web/src/lib/questions.ts
function F(e) {
	if (!Array.isArray(e.options) || e.options.length < 2) return "unresolved";
	let t = e.options.map((e) => e?.key);
	return t.some((e) => typeof e != "string" || !e.trim()) || new Set(t).size !== t.length || typeof e.correctKey != "string" || t.filter((t) => t === e.correctKey).length !== 1 || e.needsReview === !0 || e.content?.assets.some((t) => [
		"question",
		"stem",
		"choice"
	].includes(t.role) && !e.attachments?.some((e) => e.assetId === t.id)) ? "unresolved" : e.extraction && e.extraction.reviewed !== !0 ? "review-suggested" : "ready";
}
//#endregion
//#region web/src/lib/learning-intelligence/attempts.ts
function fe(e) {
	let t = [];
	for (let n of e) {
		let e = F(n) === "ready" ? n.correctKey : void 0, r = [...n.attempts].sort((e, t) => e.at.localeCompare(t.at)), i = 0;
		for (let a of r) !(a.status === "correct" || a.status === "incorrect" || a.status === "guessed") && !a.answerKey || (i += 1, t.push({
			questionId: n.id,
			at: a.at,
			exposure: i,
			correct: a.status === "correct" || a.status === "guessed" ? !0 : a.status === "incorrect" ? !1 : void 0,
			answerKey: a.answerKey,
			correctKey: e,
			seconds: a.timeSpentSeconds,
			certainty: a.certainty ?? (a.status === "guessed" ? "guess" : void 0),
			errorType: a.errorType,
			mode: a.mode,
			quizSessionId: a.quizSessionId
		}));
	}
	return t.sort((e, t) => e.at.localeCompare(t.at));
}
function I(e) {
	let t = e.filter((e) => e.correct !== void 0), n = t.filter((e) => e.correct).length;
	return {
		attempts: t.length,
		correct: n,
		accuracy: t.length ? Math.round(n / t.length * 100) : null
	};
}
//#endregion
//#region web/src/lib/targetContributions.ts
function pe(e) {
	let { requirement: t, dayKey: n } = e, r = me(t, e.productivityTrackers, e.habits), i = /* @__PURE__ */ new Map(), a = be(e.logs.filter((e) => e.dayKey === n)), o = new Set(t.excludedSourceRecordIds ?? []), s = new Set(t.includedSourceRecordIds ?? []);
	for (let s of a) {
		if (o.has(s.id)) continue;
		let a = ge(t, s, r, e.productivityTrackers);
		a !== void 0 && a !== 0 && ye(i, z({
			requirement: t,
			dayKey: n,
			unit: r,
			event: "activity",
			eventId: s.id,
			sourceRecord: "study-log",
			sourceRecordId: s.id,
			value: a,
			matchedBy: t.source.kind === "productivity-tracker" ? "linked" : "native",
			confidence: t.source.kind === "productivity-tracker" ? 1 : .99
		}));
	}
	let c = t.source.kind === "manual" ? /* @__PURE__ */ new Set() : new Set((t.aliases ?? []).map(ke).filter(Boolean));
	if (c.size) for (let e of a) {
		if (o.has(e.id) || !we(e, c)) continue;
		let a = _e(e, r, !0);
		a === void 0 || a === 0 || ye(i, z({
			requirement: t,
			dayKey: n,
			unit: r,
			event: "activity",
			eventId: e.id,
			sourceRecord: "study-log",
			sourceRecordId: e.id,
			value: a,
			matchedBy: "alias",
			confidence: .8
		}));
	}
	for (let e of a) {
		if (!s.has(e.id) || o.has(e.id)) continue;
		let a = _e(e, r, !0);
		a === void 0 || a === 0 || ye(i, z({
			requirement: t,
			dayKey: n,
			unit: r,
			event: "activity",
			eventId: e.id,
			sourceRecord: "study-log",
			sourceRecordId: e.id,
			value: a,
			matchedBy: "reassigned",
			confidence: 1
		}));
	}
	if (t.source.kind === "habit") {
		let a = xe(e.habitEntries, t.source.habitId, n);
		if (a) {
			let e = Ce(a);
			ye(i, z({
				requirement: t,
				dayKey: n,
				unit: r,
				event: "habit-check",
				eventId: a.id,
				sourceRecord: "habit-entry",
				sourceRecordId: a.id,
				value: e,
				matchedBy: "linked",
				confidence: 1,
				dedupeKey: `${t.id}:habit:${t.source.habitId}:${n}`,
				correction: a.status === "skipped" || a.status === "missed"
			}));
		}
	}
	if (t.source.kind === "journal-closeout") {
		let a = Se(e.closeouts, n);
		a && ye(i, z({
			requirement: t,
			dayKey: n,
			unit: r,
			event: "closeout",
			eventId: a.id,
			sourceRecord: "daily-closeout",
			sourceRecordId: a.id,
			value: 1,
			matchedBy: "linked",
			confidence: 1,
			dedupeKey: `${t.id}:closeout:${n}`
		}));
	}
	ve(i, t, n, r);
	let l = [...i.values()].sort(Oe), u = l.find((e) => e.manualOverride), d = l.filter((e) => !e.manualOverride).reduce((e, t) => e + t.value, 0), f = Math.max(0, H(u?.value ?? d));
	return {
		targetId: t.id,
		dayKey: n,
		unit: r,
		contributions: l,
		value: f,
		sourceRecordIds: L(l, e),
		manualOverrideId: u?.sourceRecordId
	};
}
function L(e, t) {
	let n = new Set(e.map((e) => e.sourceRecordId)), r = [
		...t.logs.filter((e) => e.dayKey === t.dayKey).map((e) => e.id),
		...t.habitEntries.filter((e) => e.date === t.dayKey).map((e) => e.id),
		...t.closeouts.filter((e) => e.dayKey === t.dayKey).map((e) => e.id),
		...(t.requirement.manualContributions ?? []).filter((e) => e.dayKey === t.dayKey).map((e) => e.id),
		...e.map((e) => e.sourceRecordId)
	], i = /* @__PURE__ */ new Set(), a = [];
	for (let e of r) !n.has(e) || i.has(e) || (i.add(e), a.push(e));
	return a;
}
function R(e) {
	let t = ke(e);
	return [
		"min",
		"mins",
		"minute",
		"minutes"
	].includes(t) ? "minutes" : [
		"card",
		"cards",
		"review",
		"reviews"
	].includes(t) ? "cards" : [
		"question",
		"questions",
		"practice question",
		"practice questions"
	].includes(t) ? "questions" : ["page", "pages"].includes(t) ? "pages" : [
		"rep",
		"reps",
		"repetition",
		"repetitions"
	].includes(t) ? "repetitions" : [
		"closeout",
		"closeouts",
		"count",
		"counts",
		"day",
		"days",
		"session",
		"sessions",
		"time",
		"times",
		"visit",
		"visits",
		"yes",
		"yes no"
	].includes(t) ? "count" : t || "count";
}
function me(e, t, n) {
	if (e.source.kind === "study-minutes") return "minutes";
	if (e.source.kind === "cards-reviewed") return "cards";
	if (e.source.kind === "practice-questions") return "questions";
	if (e.source.kind === "journal-closeout") return "count";
	if (e.source.kind === "activity-alias" || e.source.kind === "manual") return R(e.unit);
	if (e.source.kind === "productivity-tracker") {
		let n = e.source.trackerId, r = t.find((e) => e.id === n);
		return R(e.unit || he(r));
	}
	let r = e.source.habitId, i = n.find((e) => e.id === r);
	return R(e.unit || i?.unit || "count");
}
function he(e) {
	return e ? e.unitType === "minutes" ? "minutes" : e.unitType === "custom" ? e.customUnit || "count" : e.unitType === "yesno" ? "count" : e.unitType : "count";
}
function ge(e, t, n, r) {
	if (e.source.kind === "study-minutes") return t.academic === !1 ? void 0 : V(t.minutes);
	if (e.source.kind === "cards-reviewed") return t.quantityKind !== "cards" && H(t.cards) === 0 ? void 0 : V(t.quantityKind === "cards" && H(t.quantity) !== 0 ? t.quantity : t.cards);
	if (e.source.kind === "practice-questions") return t.quantityKind === "questions" || R(t.quantityLabel ?? "") === "questions" ? V(t.quantity) : void 0;
	if (e.source.kind !== "productivity-tracker" || t.trackerId !== e.source.trackerId) return;
	let i = e.source.trackerId;
	return r.find((e) => e.id === i)?.unitType === "yesno" ? V(t.quantity) ?? 1 : _e(t, n, !0);
}
function _e(e, t, n) {
	if (t === "minutes") return V(e.minutes);
	if (t === "cards") return e.quantityKind === "cards" && H(e.quantity) !== 0 ? H(e.quantity) : H(e.cards) === 0 ? n ? V(e.quantity) : void 0 : H(e.cards);
	if (t === "questions") return e.quantityKind === "questions" || R(e.quantityLabel ?? "") === "questions" || n ? V(e.quantity) : void 0;
	if (t === "pages" || t === "repetitions") return R(e.quantityLabel ?? "") === t || n ? V(e.quantity) : void 0;
	if (t === "count") return H(e.quantity) === 0 ? n && H(e.minutes) !== 0 ? Math.sign(H(e.minutes)) : n && H(e.cards) !== 0 ? Math.sign(H(e.cards)) : e.unitType === "yesno" ? 1 : void 0 : H(e.quantity);
	if (H(e.quantity) !== 0) return H(e.quantity);
	if (e.unitType === "yesno") return 1;
}
function ve(e, t, n, r) {
	let i = B(t.manualContributions ?? []).filter((e) => e.requirementId === t.id && e.dayKey === n).filter((e) => !e.unit || R(e.unit) === r), a = i.filter((e) => e.mode === "add");
	for (let i of a) ye(e, z({
		requirement: t,
		dayKey: n,
		unit: r,
		event: "manual-adjustment",
		eventId: i.id,
		sourceRecord: "manual-contribution",
		sourceRecordId: i.id,
		value: H(i.value),
		matchedBy: "manual",
		confidence: 1,
		dedupeKey: `${t.id}:manual:add:${i.id}`,
		correction: i.value < 0
	}));
	let o = i.filter((e) => e.mode === "override").sort(De).at(-1);
	o && ye(e, z({
		requirement: t,
		dayKey: n,
		unit: r,
		event: "manual-adjustment",
		eventId: o.id,
		sourceRecord: "manual-contribution",
		sourceRecordId: o.id,
		value: Math.max(0, H(o.value)),
		matchedBy: "manual",
		confidence: 1,
		manualOverride: !0,
		dedupeKey: `${t.id}:manual:override:${n}`
	}));
}
function z(e) {
	return {
		event: e.event,
		eventId: e.eventId,
		sourceRecord: e.sourceRecord,
		sourceRecordId: e.sourceRecordId,
		targetId: e.requirement.id,
		value: H(e.value),
		unit: e.unit,
		dayKey: e.dayKey,
		dedupeKey: e.dedupeKey ?? `${e.requirement.id}:${e.sourceRecord}:${e.sourceRecordId}`,
		confidence: Math.max(0, Math.min(1, H(e.confidence))),
		manualOverride: e.manualOverride === !0,
		correction: e.correction ?? e.value < 0,
		matchedBy: e.matchedBy
	};
}
function ye(e, t) {
	let n = e.get(t.dedupeKey);
	(!n || t.confidence > n.confidence || t.confidence === n.confidence && Oe(n, t) < 0) && e.set(t.dedupeKey, t);
}
function be(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of [...e].sort(Te)) t.set(n.id, n);
	return [...t.values()].sort(Te);
}
function B(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of [...e].sort(De)) t.set(n.id, n);
	return [...t.values()].sort(De);
}
function xe(e, t, n) {
	return e.filter((e) => e.habitId === t && e.date === n).sort((e, t) => e.createdAt.localeCompare(t.createdAt) || e.id.localeCompare(t.id)).at(-1);
}
function Se(e, t) {
	return e.filter((e) => e.dayKey === t).sort((e, t) => e.updatedAt.localeCompare(t.updatedAt) || e.createdAt.localeCompare(t.createdAt) || e.id.localeCompare(t.id)).at(-1);
}
function Ce(e) {
	return e.status === "done" ? Ae(e.value) || 1 : e.status === "partial" ? Ae(e.value) || .5 : 0;
}
function we(e, t) {
	return t.has(ke(e.type));
}
function Te(e, t) {
	return e.ts.localeCompare(t.ts) || e.id.localeCompare(t.id) || Ee(e).localeCompare(Ee(t));
}
function Ee(e) {
	return [
		e.type,
		e.minutes,
		e.cards,
		e.quantity,
		e.quantityKind,
		e.quantityLabel,
		e.trackerId
	].join("|");
}
function De(e, t) {
	return e.updatedAt.localeCompare(t.updatedAt) || e.createdAt.localeCompare(t.createdAt) || e.id.localeCompare(t.id) || e.value - t.value;
}
function Oe(e, t) {
	return e.dedupeKey.localeCompare(t.dedupeKey) || e.sourceRecordId.localeCompare(t.sourceRecordId) || e.value - t.value;
}
function ke(e) {
	return e.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function V(e) {
	let t = H(e);
	return t === 0 ? void 0 : t;
}
function Ae(e) {
	let t = H(e);
	return t > 0 ? t : 0;
}
function H(e) {
	let t = Number(e);
	return Number.isFinite(t) ? t : 0;
}
//#endregion
//#region web/src/lib/dailySuccess.ts
var je = /^\d{4}-\d{2}-\d{2}$/, Me = .1, Ne = 5;
function U(e, t = e.activeDayKey, n = e.activeDayKey) {
	let r = e.profile.dailySuccess, i = r ? r.requirements : Re(e), a = r ? "configured" : "legacy", o = i.map((r) => Pe(r, e, t, n)), s = o.filter((e) => e.eligible && e.status !== "unavailable"), c = s.reduce((e, t) => e + Xe(t.requirement.weight), 0), l = s.length && c > 0 ? Math.round(s.reduce((e, t) => e + t.ratio * Xe(t.requirement.weight), 0) / c * 100) : 0, u = s.filter((e) => e.status === "met").length, d = s.some((e) => e.current > 0), f = s.some((e) => e.status === "missed"), p = s.length > 0 && u === s.length, m = i.filter((e) => e.enabled).length, h = o.filter((e) => e.status === "unavailable").length, g = s.length === 0 || !d && t >= n ? "neutral" : p ? "met" : f ? "missed" : "in-progress";
	return {
		mode: a,
		dayKey: t,
		requirements: o,
		eligibleCount: s.length,
		metCount: u,
		progress: l,
		status: g,
		statusLabel: g === "neutral" ? s.length ? "Awaiting first activity" : i.length === 0 ? "No requirements selected" : h > 0 ? `${h === 1 ? "Requirement source" : "Requirement sources"} unavailable` : m > 0 ? "No requirements scheduled today" : "No requirements enabled" : g === "met" ? "Daily requirements met" : g === "missed" ? "Requirements not completed" : "In progress"
	};
}
function Pe(e, t, n, r) {
	let i = Ye(e.target, 1), a = {
		requirement: e,
		current: 0,
		target: i,
		ratio: 0,
		sourceLabel: We(e.source),
		sourceRecordIds: [],
		contributions: [],
		calculation: "Not eligible on this date."
	};
	if (!e.enabled || n < e.trackingStartsAt) return {
		...a,
		eligible: !1,
		status: "not-eligible"
	};
	if (!Ie(e.source, t.productivityTrackers, t.habits)) return {
		...a,
		eligible: !0,
		status: "unavailable",
		calculation: "The linked source is no longer available. Existing activity history was not removed."
	};
	if (e.schedule.kind === "weekdays" && !e.schedule.weekdays.includes(Ke(n))) return {
		...a,
		eligible: !1,
		status: "not-eligible"
	};
	if (e.schedule.kind === "times-per-week") return Fe(e, t, n, r, a);
	let o = W(e, t, n), s = o.value, c = Ze(s / i), l = s >= i ? "met" : s > 0 ? "in-progress" : n >= r ? "awaiting" : "missed";
	return {
		...a,
		eligible: !0,
		current: s,
		ratio: c,
		status: l,
		sourceRecordIds: o.ids,
		contributions: o.contributions,
		calculation: `${Qe(s)} of ${Qe(i)} ${e.unit}`
	};
}
function Fe(e, t, n, r, i) {
	let a = e.schedule, o = Ge(n, +(a.weekStartsOn === 1)), s = N(o, 6);
	if (n < r && n !== s) return {
		...i,
		eligible: !1,
		status: "not-eligible"
	};
	let c = [];
	for (let t = o; t <= s; t = N(t, 1)) t >= e.trackingStartsAt && c.push(t);
	let l = n < r ? s : r, u = [];
	for (let t = o; t <= s; t = N(t, 1)) t >= e.trackingStartsAt && t <= l && u.push(t);
	let d = [], f = [];
	for (let n of u) {
		let r = W(e, t, n);
		d.push(r), r.value >= i.target && f.push(r);
	}
	let p = Math.max(1, Math.min(c.length || 1, Math.min(7, Math.round(Ye(a.times, 1))))), m = f.length, h = m >= p, g = n < r && n === s;
	return {
		...i,
		eligible: !0,
		current: m,
		target: p,
		ratio: Ze(m / p),
		status: h ? "met" : g ? "missed" : m ? "in-progress" : "awaiting",
		sourceRecordIds: [...new Set(d.flatMap((e) => e.ids))],
		contributions: d.flatMap((e) => e.contributions),
		calculation: `${m} of ${p} scheduled completions for ${o}–${s}`
	};
}
function W(e, t, n) {
	let r = pe({
		requirement: e,
		dayKey: n,
		logs: t.logs,
		productivityTrackers: t.productivityTrackers,
		habits: t.habits,
		habitEntries: t.habitEntries,
		closeouts: t.closeouts
	});
	return {
		value: r.value,
		ids: r.sourceRecordIds,
		contributions: r.contributions
	};
}
function Ie(e, t, n) {
	return e.kind === "productivity-tracker" ? t.some((t) => t.id === e.trackerId && !t.archived) : e.kind === "habit" ? n.some((t) => t.id === e.habitId && !t.archived) : !0;
}
function Le(e, t = M()) {
	let n = (/* @__PURE__ */ new Date()).toISOString();
	return {
		id: e.id,
		label: e.label.trim() || We(e.source),
		source: e.source,
		enabled: e.enabled ?? !0,
		aliases: Be(e.aliases),
		excludedSourceRecordIds: Ve(e.excludedSourceRecordIds),
		includedSourceRecordIds: Ve(e.includedSourceRecordIds),
		manualContributions: He(e.manualContributions, e.id),
		weight: Xe(e.weight),
		target: Ye(e.target, 1),
		unit: e.unit.trim() || "times",
		schedule: ze(e.schedule),
		trackingStartsAt: qe(e.trackingStartsAt) ?? t,
		createdAt: e.createdAt ?? n,
		updatedAt: e.updatedAt ?? n
	};
}
function Re(e) {
	let t = [...e.logs].sort((e, t) => e.dayKey.localeCompare(t.dayKey))[0]?.dayKey, n = qe(t) ?? e.activeDayKey, r = `${n}T12:00:00.000Z`;
	return [Le({
		id: "legacy-study-minutes",
		label: "Study minutes",
		source: { kind: "study-minutes" },
		target: Ye(e.profile.dailyMinuteTarget, 240),
		unit: "minutes",
		trackingStartsAt: n,
		createdAt: r,
		updatedAt: r
	}, n), Le({
		id: "legacy-cards-reviewed",
		label: "Cards reviewed",
		source: { kind: "cards-reviewed" },
		target: Ye(e.profile.dailyCardTarget, 120),
		unit: "cards",
		trackingStartsAt: n,
		createdAt: r,
		updatedAt: r
	}, n)];
}
function ze(e) {
	if (!et(e)) return { kind: "daily" };
	if (e.kind === "weekdays") {
		let t = Array.isArray(e.weekdays) ? [...new Set(e.weekdays.map(Number).filter((e) => Number.isInteger(e) && e >= 0 && e <= 6))] : [];
		return t.length ? {
			kind: "weekdays",
			weekdays: t
		} : { kind: "daily" };
	}
	return e.kind === "times-per-week" ? {
		kind: "times-per-week",
		times: Math.max(1, Math.min(7, Math.round(Ye(e.times, 1)))),
		weekStartsOn: +(e.weekStartsOn === 1)
	} : { kind: "daily" };
}
function Be(e) {
	if (!Array.isArray(e)) return;
	let t = [], n = /* @__PURE__ */ new Set();
	for (let r of e) {
		if (typeof r != "string") continue;
		let e = r.trim().replace(/\s+/g, " ").slice(0, 80), i = e.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
		if (!(!e || !i || n.has(i)) && (n.add(i), t.push(e), t.length >= 20)) break;
	}
	return t.length ? t : void 0;
}
function Ve(e) {
	if (!Array.isArray(e)) return;
	let t = [...new Set(e.filter((e) => typeof e == "string").map((e) => e.trim().slice(0, 160)).filter(Boolean))].slice(0, 200);
	return t.length ? t : void 0;
}
function He(e, t) {
	if (!Array.isArray(e)) return;
	let n = /* @__PURE__ */ new Map();
	for (let r of e) {
		if (!et(r)) continue;
		let e = typeof r.id == "string" ? r.id.trim().slice(0, 160) : "", i = qe(r.dayKey), a = Number(r.value);
		if (!e || !i || !Number.isFinite(a)) continue;
		let o = $e(r.createdAt, `${i}T12:00:00.000Z`), s = r.mode === "add" ? "add" : "override", c = {
			id: e,
			requirementId: t,
			dayKey: i,
			value: s === "override" ? Math.max(0, a) : a,
			unit: typeof r.unit == "string" && r.unit.trim() ? r.unit.trim().slice(0, 40) : void 0,
			note: typeof r.note == "string" && r.note.trim() ? r.note.trim().slice(0, 240) : void 0,
			mode: s,
			createdAt: o,
			updatedAt: $e(r.updatedAt, o)
		}, l = n.get(e);
		(!l || Ue(l, c) < 0) && n.set(e, c);
	}
	let r = [...n.values()].sort(Ue);
	return r.length ? r : void 0;
}
function Ue(e, t) {
	return e.updatedAt.localeCompare(t.updatedAt) || e.createdAt.localeCompare(t.createdAt) || e.id.localeCompare(t.id) || e.mode.localeCompare(t.mode) || (e.note ?? "").localeCompare(t.note ?? "") || e.value - t.value;
}
function We(e) {
	return e.kind === "study-minutes" ? "Study activity" : e.kind === "cards-reviewed" ? "Card reviews" : e.kind === "practice-questions" ? "Practice questions" : e.kind === "journal-closeout" ? "Daily closeout" : e.kind === "activity-alias" ? "Matched activity" : e.kind === "manual" ? "Manual check-in" : e.kind === "habit" ? "Habit activity" : "Productivity activity";
}
function Ge(e, t) {
	return N(e, -((Ke(e) - t + 7) % 7));
}
function Ke(e) {
	return (/* @__PURE__ */ new Date(`${e}T12:00:00`)).getDay();
}
function qe(e) {
	return typeof e == "string" && je.test(e) && !Number.isNaN((/* @__PURE__ */ new Date(`${e}T12:00:00`)).getTime()) ? e : void 0;
}
function Je(e) {
	let t = Number(e);
	return Number.isFinite(t) && t > 0 ? t : 0;
}
function Ye(e, t) {
	return Je(e) || t;
}
function Xe(e) {
	let t = Number(e);
	return !Number.isFinite(t) || t <= 0 ? 1 : Math.max(Me, Math.min(Ne, t));
}
function Ze(e) {
	return Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0;
}
function Qe(e) {
	return Number.isInteger(e) ? String(e) : e.toFixed(1);
}
function $e(e, t = (/* @__PURE__ */ new Date()).toISOString()) {
	if (typeof e != "string") return t;
	let n = new Date(e);
	return Number.isNaN(n.getTime()) ? t : n.toISOString();
}
function et(e) {
	return !!e && typeof e == "object" && !Array.isArray(e);
}
//#endregion
//#region web/src/lib/tracker.ts
var tt = new Set([
	"Requirement",
	"Milestone",
	"Evidence"
]), nt = new Set([
	"PQ",
	"Question Block",
	"Assessment"
]);
function rt(e) {
	return tt.has(e);
}
function it(e) {
	return nt.has(e);
}
function at(e) {
	return rt(e.kind) ? 1 : it(e.kind) ? 3 : e.yield === "low" ? 2 : e.yield === "high" || e.yield === "review" ? 4 : 3;
}
//#endregion
//#region web/src/lib/reports.ts
function ot(e, t) {
	let n = e.activeDayKey, r = st(n, t), i = ct(e), a = r.filter((e) => e >= i && e <= n), o = a.map((t) => U(e, t, n)).filter((e) => e.eligibleCount > 0), s = o.map((e) => e.dayKey), c = o.filter((e) => e.dayKey < n || e.status === "met"), l = c.map((e) => e.dayKey), u = e.logs.filter((e) => a.includes(e.dayKey)), d = a.filter((t) => G(e.logs, t)), f = s.filter((t) => G(e.logs, t)), p = l.filter((t) => G(e.logs, t)), m = c.filter((e) => e.status === "met").map((e) => e.dayKey), h = dt(u, (e) => K(e.minutes)), g = dt(u, (e) => K(e.quantity) || K(e.cards)), _ = e.tracker.filter((e) => e.passes < at(e) || e.yield === "review"), v = e.tracker.filter((e) => e.passes >= at(e)), y = e.tracker.filter((e) => e.passes > 0), b = e.tracker.filter((e) => e.ankiPasses > 0), x = r[0] ?? n, S = e.tasks.filter((e) => !e.archived && (e.due && e.due.slice(0, 10) >= x && e.due.slice(0, 10) <= n || e.completedAt && e.completedAt.slice(0, 10) >= x && e.completedAt.slice(0, 10) <= n)), C = S.filter((e) => e.done), w = S.filter((e) => !e.done && !!e.due), T = w.filter((e) => e.due.slice(0, 10) < n), E = lt(e, i), D = `${a.length} observed day${a.length === 1 ? "" : "s"}`, O = `${l.length} scored eligible day${l.length === 1 ? "" : "s"}`, ee = `${r.length}-day window ending ${n}`, k = ft(p.length, l.length), te = ft(m.length, c.length), A = ft(v.length, e.tracker.length), j = e.profile.dailySuccess ? e.profile.dailySuccess.requirements.some((e) => e.enabled) : !0;
	return {
		startKey: x,
		endKey: n,
		observedDates: a,
		eligibleDates: s,
		scoredDates: l,
		activeDates: f,
		successfulDates: m,
		metrics: {
			study: {
				id: "study",
				label: "Recorded activity",
				value: h ? `${Math.round(h / 60)}h` : d.length ? `${d.length}` : "No data",
				note: h ? `${h} minutes${g ? ` · ${g} recorded units` : ""}` : `${d.length} active day${d.length === 1 ? "" : "s"}`,
				numerator: h,
				denominator: a.length,
				period: D,
				sourceLabel: "Activity log",
				sourceRecordIds: u.map((e) => e.id),
				calculation: `${h} net minutes across ${u.length} in-range activity record${u.length === 1 ? "" : "s"}; signed corrections are applied before each day is clamped at zero.`,
				interpretation: u.length ? "This is recorded effort, not a judgment of quality." : "AXOM needs a real activity before it can describe effort.",
				action: u.length ? "Review the activity timeline" : "Log one activity",
				state: u.length ? "ready" : "neutral"
			},
			streak: {
				id: "streak",
				label: "Current streak",
				value: c.length ? `${E}` : "Building",
				note: c.length ? `${E === 1 ? "eligible day" : "eligible days"} meeting selected requirements` : "No completed eligible success days yet",
				numerator: E,
				denominator: c.length,
				period: O,
				sourceLabel: "Daily-success requirements and their linked records",
				sourceRecordIds: pt(c.flatMap((e) => e.requirements.flatMap((e) => e.sourceRecordIds))),
				calculation: "Counts consecutive eligible days whose selected requirements were met; today awaiting activity does not break it.",
				interpretation: E ? "The current eligible rhythm is intact." : "A streak starts only after a selected requirement is met.",
				action: "Review today's remaining requirements",
				state: c.length ? "ready" : "neutral"
			},
			consistency: {
				id: "consistency",
				label: "Consistency",
				value: l.length ? `${k}%` : "Building",
				note: `${p.length}/${l.length} completed eligible days had activity`,
				numerator: p.length,
				denominator: l.length,
				period: O,
				sourceLabel: "Positive activity records",
				sourceRecordIds: u.filter((e) => p.includes(e.dayKey)).map((e) => e.id),
				calculation: `${p.length} active completed eligible days ÷ ${l.length} completed eligible days. Off-schedule dates, dates before tracking began, and a pending current day are excluded.`,
				interpretation: l.length < 3 ? "More completed eligible days are needed before a pattern is meaningful." : k >= 70 ? "Activity is appearing on most eligible days." : "The pattern is still intermittent.",
				action: "Choose the smallest repeatable next action",
				state: l.length >= 3 ? "ready" : l.length ? "low-data" : "neutral"
			},
			"daily-success": {
				id: "daily-success",
				label: "Daily success",
				value: c.length ? `${te}%` : j ? "Building" : "Not configured",
				note: c.length ? `${m.length}/${c.length} eligible days met selected requirements` : j ? "No completed eligible requirement day is ready to score" : "Choose requirements before this metric is scored",
				numerator: m.length,
				denominator: c.length,
				period: O,
				sourceLabel: "Configured daily-success selector",
				sourceRecordIds: pt(c.flatMap((e) => e.requirements.flatMap((e) => e.sourceRecordIds))),
				calculation: c.length ? `${m.length} successful eligible days ÷ ${c.length} scored eligible days.` : j ? "No completed eligible requirement day produced a denominator; a pending current day is excluded." : "No configured eligible requirement produced a denominator.",
				interpretation: c.length ? "Only requirements active on each date are considered." : j ? "The first result appears after an eligible day is completed or today's requirements are met." : "Cards, minutes, and every other supported signal remain optional.",
				action: j ? "Review today's requirements" : "Configure daily requirements",
				state: c.length >= 3 ? "ready" : c.length ? "low-data" : "neutral"
			},
			"tracker-mastery": {
				id: "tracker-mastery",
				label: "Tracker mastery",
				value: e.tracker.length ? `${A}%` : "No data",
				note: e.tracker.length ? `${v.length} completed · ${_.length} active` : "Add or import tracked items",
				numerator: v.length,
				denominator: e.tracker.length,
				period: "Current tracker state",
				sourceLabel: "Course Tracker items",
				sourceRecordIds: e.tracker.map((e) => e.id),
				calculation: `${v.length} completed at target ÷ ${e.tracker.length} tracked items. ${y.length} reviewed; ${b.length} Anki-linked.`,
				interpretation: "Completion, review progress, and Anki linkage are disclosed separately rather than collapsed into one claim.",
				action: "Open Course Tracker",
				state: e.tracker.length ? "ready" : "neutral"
			},
			tasks: {
				id: "tasks",
				label: "Tasks",
				value: S.length ? `${C.length}/${S.length}` : "No due tasks",
				note: `${C.length} completed · ${w.length} due · ${T.length} overdue`,
				numerator: C.length,
				denominator: S.length,
				period: ee,
				sourceLabel: "Non-archived tasks due or completed in the period",
				sourceRecordIds: S.map((e) => e.id),
				calculation: "Counts non-archived tasks whose due or completion date falls inside the selected report window.",
				interpretation: T.length ? `${T.length} overdue task${T.length === 1 ? "" : "s"} may need a decision.` : "No overdue in-period task is detected.",
				action: T.length ? "Review overdue tasks" : "Review current tasks",
				state: S.length ? "ready" : "neutral"
			}
		}
	};
}
function st(e, t) {
	let n = Math.max(1, Math.min(366, Math.floor(Number.isFinite(t) ? t : 1)));
	return Array.from({ length: n }, (t, r) => N(e, r - n + 1));
}
function ct(e) {
	let t = e.profile.dailySuccess?.requirements.filter((e) => e.enabled).map((e) => e.trackingStartsAt).filter(Boolean) ?? [];
	return t.length ? [...t].sort()[0] : [...e.logs].filter(ut).sort((e, t) => e.dayKey.localeCompare(t.dayKey))[0]?.dayKey ?? e.activeDayKey;
}
function lt(e, t) {
	let n = e.activeDayKey, r = 0, i = !0;
	for (let a = 0; a < 366 && n >= t; a += 1) {
		let t = U(e, n, e.activeDayKey);
		if (t.eligibleCount === 0) {
			n = N(n, -1), i = !1;
			continue;
		}
		if (i && t.status !== "met") {
			n = N(n, -1), i = !1;
			continue;
		}
		if (t.status === "met") r += 1;
		else break;
		n = N(n, -1), i = !1;
	}
	return r;
}
function ut(e) {
	return K(e.minutes) > 0 || K(e.cards) > 0 || K(e.quantity) > 0;
}
function G(e, t) {
	let n = e.filter((e) => e.dayKey === t), r = n.reduce((e, t) => e + K(t.minutes), 0), i = n.reduce((e, t) => e + K(t.cards), 0), a = n.reduce((e, t) => e + K(t.quantity), 0);
	return r > 0 || i > 0 || a > 0;
}
function dt(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r of e) n.set(r.dayKey, (n.get(r.dayKey) ?? 0) + K(t(r)));
	return [...n.values()].reduce((e, t) => e + Math.max(0, t), 0);
}
function ft(e, t) {
	return t > 0 ? Math.round(e / t * 100) : 0;
}
function K(e) {
	let t = Number(e);
	return Number.isFinite(t) ? t : 0;
}
function pt(e) {
	return [...new Set(e)];
}
new Set("a an and are as at be by for from has have in is it its of on or that the this to was were which with most likely following patient".split(" "));
//#endregion
//#region web/src/lib/communications/snapshot.ts
function mt(e, t) {
	let { start: n, end: r, timezone: i } = t, a = Math.round((Date.parse(`${r}T00:00:00Z`) - Date.parse(`${n}T00:00:00Z`)) / 864e5) + 1;
	if (!Number.isFinite(a) || a < 1 || a > 370) throw Error("Choose a reporting period of 1 to 370 days.");
	let o = (e) => e >= n && e <= r, c = (e) => Number.isFinite(Date.parse(e)) ? f(new Date(e), i).day : "", l = ot({
		...e,
		activeDayKey: r
	}, a), u = fe(e.questions).filter((e) => o(c(e.at))), d = I(u), p = (/* @__PURE__ */ new Date(Date.parse(`${n}T00:00:00Z`) - a * 864e5)).toISOString().slice(0, 10), m = I(fe(e.questions).filter((e) => c(e.at) >= p && c(e.at) < n)), h = {
		currentScored: d.attempts,
		previousScored: m.attempts,
		...d.attempts >= 8 && m.attempts >= 8 && d.accuracy !== null && m.accuracy !== null ? { accuracyDelta: d.accuracy - m.accuracy } : {}
	}, g = I(u.filter((e) => e.exposure === 1 && e.mode !== "tutor")), _ = e.logs.filter((e) => o(e.dayKey)), v = [];
	_.length && v.push({
		id: "minutes",
		label: "Recorded study",
		value: l.metrics.study.numerator,
		unit: "min",
		note: l.metrics.study.calculation
	}), u.length && v.push({
		id: "questions",
		label: "Questions answered",
		value: u.length,
		unit: "",
		note: "Recorded answer attempts, including repeats and Tutor answers. Flag-only events are excluded."
	}), d.accuracy !== null && v.push({
		id: "accuracy",
		label: "Recorded accuracy",
		value: d.accuracy,
		unit: "%",
		note: `${d.correct} correct of ${d.attempts} scored attempts. Includes repeated and Tutor answers.`
	}), g.accuracy !== null && v.push({
		id: "firstAccuracy",
		label: "First-answer accuracy",
		value: g.accuracy,
		unit: "%",
		note: `${g.attempts} first exposures excluding Tutor mode. Source provenance remains on the original questions.`
	});
	let y = new Set([...l.activeDates, ...u.map((e) => c(e.at))]);
	y.size && v.push({
		id: "days",
		label: "Active days",
		value: y.size,
		unit: "",
		note: "Distinct recorded study dates or answer dates in this period. Study logs retain AXOM's study-day boundary."
	}), l.metrics.streak.state !== "neutral" && v.push({
		id: "streak",
		label: "Current eligible streak",
		value: l.metrics.streak.numerator,
		unit: "days",
		note: l.metrics.streak.calculation
	}), l.metrics.consistency.state === "ready" && v.push({
		id: "consistency",
		label: "Scheduled consistency",
		value: Math.round(l.metrics.consistency.numerator / l.metrics.consistency.denominator * 100),
		unit: "%",
		note: l.metrics.consistency.calculation
	});
	let b = e.cardReviews.filter((e) => o(c(e.at)));
	b.length && v.push({
		id: "reviews",
		label: "Anki Lab reviews",
		value: b.length,
		unit: "",
		note: "Reviews recorded in AXOM Anki Lab. This does not measure external Anki retention."
	});
	let x = new Map(e.questions.map((e) => [e.id, e])), S = new Date(Date.parse(`${n}T00:00:00Z`) + Math.floor(a / 2) * 864e5).toISOString().slice(0, 10), C = [...new Set(u.map((e) => x.get(e.questionId)?.system).filter((e) => !!e))].flatMap((e) => {
		let t = u.filter((t) => x.get(t.questionId)?.system === e && t.exposure === 1 && t.mode !== "tutor"), n = I(t);
		if (n.attempts < 8 || n.accuracy === null) return [];
		let r = I(t.filter((e) => c(e.at) < S)), i = I(t.filter((e) => c(e.at) >= S));
		return [{
			name: e,
			attempts: n.attempts,
			accuracy: n.accuracy,
			...r.attempts >= 8 && i.attempts >= 8 && r.accuracy !== null && i.accuracy !== null ? { delta: i.accuracy - r.accuracy } : {}
		}];
	}).sort((e, t) => t.accuracy - e.accuracy), w = [...new Set(u.map((e) => c(e.at).slice(0, t.scope === "year" ? 7 : 10)))].sort().map((e) => ({
		label: e,
		...I(u.filter((t) => c(t.at).startsWith(e)))
	})), T = new Set(u.map((e) => x.get(e.questionId)?.courseId).filter(Boolean)), E = e.courses.filter((e) => T.has(e.id)).map((e) => e.name), D = e.dailyWordPuzzles.filter((e) => e.completed && o(e.puzzleDate)), O = [
		"Only recorded activity is included. Missing metrics are omitted.",
		"External Anki retention, cards matured and external game performance are not available in this snapshot.",
		"System comparisons require at least 8 first answers outside Tutor mode; gains require 8 in each half."
	];
	return t.source === "protected-copy" && O.push(`Based on the protected workspace copy from ${t.sourceUpdatedAt ?? "an unknown date"}. Device-only changes are not included.`), {
		version: 1,
		scope: t.scope,
		periodStart: n,
		periodEnd: r,
		generatedAt: (t.now ?? /* @__PURE__ */ new Date()).toISOString(),
		source: t.source ?? "device",
		sourceUpdatedAt: t.sourceUpdatedAt,
		displayName: e.profile.name.trim() || "Learner",
		accent: s(t.accent),
		metrics: v,
		systems: C,
		trend: w,
		comparison: h,
		milestones: [
			100,
			500,
			1e3,
			5e3,
			1e4
		].filter((e) => u.length >= e).map((e) => `${e.toLocaleString("en")} recorded answers this period`),
		coverage: O,
		courses: E,
		games: D.length ? [{
			name: "DailyWord",
			count: D.length
		}] : []
	};
}
//#endregion
//#region web/src/lib/communications/server/provider.ts
var q = class extends Error {
	status;
	constructor(e) {
		super(`provider-${e}`), this.status = e;
	}
}, ht = class {
	env;
	fetcher;
	constructor(e, t = fetch) {
		this.env = e, this.fetcher = t;
	}
	async request(e, t = "GET", n, r) {
		if (!this.env.RESEND_API_KEY) throw Error("Resend is not configured.");
		let i = await this.fetcher(`https://api.resend.com${e}`, {
			method: t,
			headers: {
				Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
				...r ? { "Idempotency-Key": r } : {}
			},
			body: n === void 0 ? void 0 : JSON.stringify(n),
			signal: AbortSignal.timeout(2e4)
		});
		if (!i.ok) throw new q(i.status);
		return await i.json();
	}
	prepare(e, t, n) {
		let r = t.category === "essays_from_jafar" ? this.env.AXOM_EMAIL_FROM_EDITORIAL : [
			"auth",
			"security",
			"account",
			"privacy",
			"data_export",
			"account_deletion"
		].includes(t.category) ? this.env.AXOM_EMAIL_FROM_ACCOUNT : this.env.AXOM_EMAIL_FROM_REPORTS;
		if (!r || /[\r\n]/.test(r)) throw Error("verified-sender-required");
		return {
			from: r,
			to: [e],
			subject: t.subject,
			html: t.html,
			text: t.text,
			...this.env.AXOM_EMAIL_REPLY_TO ? { reply_to: this.env.AXOM_EMAIL_REPLY_TO } : {},
			...n ? { headers: {
				"List-Unsubscribe": `<${n}>`,
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
			} } : {}
		};
	}
	checkDelivery(e, t) {
		let n = this.env.AXOM_EMAIL_MODE ?? "disabled", r = (this.env.AXOM_EMAIL_TEST_RECIPIENTS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
		if (!["live", "test"].includes(n) || (n === "test" || t) && e.some((e) => !r.includes(e.toLowerCase()))) throw Error("delivery-disabled-or-recipient-not-allowlisted");
	}
	async sendPrepared(e, t, n = !1) {
		this.checkDelivery(e.to, n);
		let r = await this.request("/emails", "POST", e, t);
		if (!r.id) throw Error("provider-missing-message-id");
		return r.id;
	}
	async send(e, t, n, r, i = !1) {
		return this.checkDelivery([e], i), this.sendPrepared(this.prepare(e, t, r), n, i);
	}
};
async function gt(e) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e)))].map((e) => e.toString(16).padStart(2, "0")).join("");
}
async function _t(e, t, n, r = Date.now()) {
	let i = t.get("svix-id"), a = t.get("svix-timestamp"), o = t.get("svix-signature");
	if (!i || !a || !/^\d+$/.test(a) || !o || Math.abs(r / 1e3 - Number(a)) > 300) throw Error("invalid-webhook");
	let s = (e) => Uint8Array.from(atob(e), (e) => e.charCodeAt(0)), c = await crypto.subtle.importKey("raw", s(n.replace(/^whsec_/, "")), {
		name: "HMAC",
		hash: "SHA-256"
	}, !1, ["verify"]), l = new TextEncoder().encode(`${i}.${a}.${e}`), u = !1;
	for (let e of o.split(" ")) {
		let [t, n] = e.split(",");
		if (t === "v1" && n) try {
			await crypto.subtle.verify("HMAC", c, s(n), l) && (u = !0);
		} catch {}
	}
	if (!u) throw Error("invalid-webhook");
	let d = JSON.parse(e);
	if (typeof d.type != "string" || !d.data || !Number.isFinite(Date.parse(d.created_at))) throw Error("invalid-webhook-payload");
	return d;
}
//#endregion
//#region web/src/lib/communications/server/service.ts
function J(e) {
	if (e.error) throw Error("database-operation-failed");
	return e.data;
}
function Y(e) {
	let t = J(e);
	if (t == null) throw Error("record-unavailable");
	return t;
}
var vt = class {
	db;
	env;
	provider;
	base;
	constructor(e, t, n) {
		this.db = e, this.env = t, this.provider = new ht(t, n), this.base = t.AXOM_PUBLIC_URL ?? "https://axom.info";
	}
	async user(e) {
		let t = await this.db.auth.admin.getUserById(e);
		if (t.error || !t.data.user) throw Error("account-unavailable");
		let n = t.data;
		if (!n.user) throw Error("account-unavailable");
		return n.user;
	}
	async preferenceRows(e) {
		let t = J(await this.db.from("communication_preferences").select("category,enabled,time,weekday,timezone").eq("user_id", e));
		return i().map((e) => t.find((t) => t.category === e.category) ?? e);
	}
	async identity(e) {
		return J(await this.db.from("communication_identity").select("accent,theme,locale,contact_id,updated_at").eq("user_id", e).maybeSingle()) ?? {
			accent: "#c8a96a",
			theme: "dark",
			locale: "en"
		};
	}
	async workspace(e) {
		let t = J(await this.db.from("workspaces").select("current_revision").eq("user_id", e).maybeSingle());
		if (!t) return null;
		let n = J(await this.db.from("workspace_revisions").select("snapshot_payload,created_at,content_hash").eq("user_id", e).eq("revision", t.current_revision).neq("reason", "conflict").maybeSingle());
		if (!n) return null;
		let r = n.snapshot_payload;
		if (!r.profile || !Array.isArray(r.questions) || !Array.isArray(r.logs)) throw Error("protected-copy-needs-upgrade");
		return {
			state: r,
			at: n.created_at,
			hash: n.content_hash
		};
	}
	async context(e) {
		let [t, n, r, i, a] = await Promise.all([
			this.user(e),
			this.db.from("account_profiles").select("display_name").eq("user_id", e).maybeSingle(),
			this.identity(e),
			this.workspace(e),
			this.preferenceRows(e)
		]), o = J(n)?.display_name || i?.state.profile.name || "", c = i?.state, u = a.find((e) => e.enabled)?.timezone ?? "UTC", d = f(/* @__PURE__ */ new Date(), u).day, p = c ? se(c, d) : void 0, m = new Set(c?.profile.hiddenNav ?? []);
		return {
			displayName: o || l(t.user_metadata?.display_name ?? ""),
			accent: s(r.accent),
			theme: r.theme,
			locale: r.locale,
			timezone: u,
			orbUrl: `${this.base}/icons/axom-orb-512.png`,
			course: c?.courses[0]?.name,
			games: c?.profile.experimentalFlags?.dailyGames ? [{
				id: "doctordle",
				name: "DoctorDle",
				route: "doctordle"
			}, {
				id: "daily-word",
				name: "DailyWord",
				route: "daily-word"
			}].filter((e) => !m.has(e.id)).map((e) => ({
				name: e.name,
				url: `${this.base}/#${e.route}`,
				detail: "Open the latest available case. External results are not tracked automatically."
			})) : [],
			exam: p
		};
	}
	async snapshot(e, t, n, r, i) {
		let a = `${n}/${r}`, o = J(await this.db.from("pulse_snapshots").select("id,payload").eq("user_id", e).eq("scope", t).eq("period_key", a).maybeSingle());
		if (o) return o;
		let [s, c] = await Promise.all([this.workspace(e), this.identity(e)]);
		if (!s) return null;
		let l = mt(s.state, {
			scope: t,
			start: n,
			end: r,
			timezone: i,
			accent: c.accent,
			source: "protected-copy",
			sourceUpdatedAt: s.at
		}), u = await this.db.from("pulse_snapshots").insert({
			user_id: e,
			scope: t,
			period_key: a,
			payload: l,
			source_hash: s.hash
		}).select("id,payload").single();
		return u.error?.code === "23505" ? Y(await this.db.from("pulse_snapshots").select("id,payload").eq("user_id", e).eq("scope", t).eq("period_key", a).single()) : J(u);
	}
	async enqueue(e) {
		let t = n[e.type];
		if (!t) throw Error("unsupported-email-type");
		let r = await this.db.from("email_jobs").insert({
			user_id: e.userId,
			type: e.type,
			category: t,
			idempotency_key: e.key,
			variables: e.variables ?? {},
			snapshot_id: e.snapshotId,
			campaign_id: e.campaignId,
			scheduled_for: e.scheduledFor ?? (/* @__PURE__ */ new Date()).toISOString(),
			status: e.scheduledFor ? "scheduled" : "queued"
		});
		r.error?.code !== "23505" && J(r);
	}
	async unsubscribeUrl(e, t, n) {
		if (!this.env.AXOM_COMMUNICATIONS_TOKEN_SECRET) throw Error("unsubscribe-token-secret-required");
		let r = await gt(`${this.env.AXOM_COMMUNICATIONS_TOKEN_SECRET}:${e}:${t}:${n}`);
		return J(await this.db.from("communication_tokens").upsert({
			token_hash: await gt(r),
			user_id: e,
			category: t,
			expires_at: new Date(Date.now() + 400 * 864e5).toISOString()
		})), `${this.env.SUPABASE_URL}/functions/v1/communications?action=unsubscribe&token=${r}`;
	}
	async sendAxomEmail(e) {
		if (e.campaign_id && Y(await this.db.from("email_campaigns").select("status").eq("id", e.campaign_id).single()).status === "cancelled") {
			J(await this.db.from("email_jobs").update({ status: "cancelled" }).eq("id", e.id));
			return;
		}
		let t = await this.user(e.user_id), i = n[e.type], [a, o, s, c] = await Promise.all([
			this.preferenceRows(e.user_id),
			this.db.from("email_suppressions").select("email").eq("email", (t.email ?? "").toLowerCase()).maybeSingle(),
			this.db.from("privacy_requests").select("id").eq("user_id", e.user_id).eq("kind", "deletion").in("status", [
				"scheduled",
				"processing",
				"failed"
			]).limit(1),
			this.context(e.user_id)
		]), l = d(i, {
			verified: !!t.email_confirmed_at,
			addressValid: !!(t.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)),
			suppressed: !!J(o),
			deletionPending: (J(s) ?? []).length > 0,
			preference: a.find((e) => e.category === i)
		});
		if (l === "unverified-address" && e.type === "welcome" && Date.now() - Date.parse(e.created_at) < 30 * 864e5) {
			J(await this.db.from("email_jobs").update({
				status: "queued",
				attempts: Math.max(0, e.attempts - 1),
				scheduled_for: new Date(Date.now() + 36e5).toISOString(),
				failure_code: "awaiting-verification"
			}).eq("id", e.id));
			return;
		}
		if (l) {
			J(await this.db.from("email_jobs").update({
				status: "suppressed",
				failure_code: l
			}).eq("id", e.id));
			return;
		}
		e.snapshot_id && (c.snapshot = Y(await this.db.from("pulse_snapshots").select("payload").eq("id", e.snapshot_id).eq("user_id", e.user_id).single()).payload);
		let u = e.delivery_payload;
		if (u && u.to[0]?.toLowerCase() !== t.email?.toLowerCase()) {
			J(await this.db.from("email_jobs").update({
				status: "suppressed",
				failure_code: "recipient-changed"
			}).eq("id", e.id));
			return;
		}
		if (!u) {
			let n = r(i) ? await this.unsubscribeUrl(e.user_id, i, e.id) : void 0, a = e.variables.actionUrl;
			e.type === "export_ready" && e.variables.requestId && (await this.exportRecord(e.user_id, e.variables.requestId), a = `${this.base}/#privacy`);
			let o = {
				type: e.type,
				context: c,
				baseUrl: this.base,
				unsubscribeUrl: n,
				actionUrl: a,
				date: e.variables.date,
				editorial: e.variables.editorial
			};
			if (!D(o)) {
				J(await this.db.from("email_jobs").update({
					status: "suppressed",
					failure_code: "missing-source-data"
				}).eq("id", e.id));
				return;
			}
			u = this.provider.prepare(t.email, A(o), n), Y(await this.db.from("email_jobs").update({
				delivery_payload: u,
				first_attempt_at: (/* @__PURE__ */ new Date()).toISOString()
			}).eq("id", e.id).eq("status", "processing").select("id").single());
		}
		let f = await this.provider.sendPrepared(u, e.idempotency_key, e.variables.test);
		J(await this.db.from("email_jobs").update({
			status: "sent",
			provider_id: f,
			sent_at: (/* @__PURE__ */ new Date()).toISOString(),
			failure_code: null
		}).eq("id", e.id).eq("status", "processing")), J(await this.db.from("email_send_log").upsert({
			job_id: e.id,
			attempt: e.attempts,
			outcome: "sent",
			provider_id: f
		}, { onConflict: "job_id,attempt" }));
	}
	async work() {
		if (!this.env.RESEND_API_KEY || !["test", "live"].includes(this.env.AXOM_EMAIL_MODE ?? "")) return { processed: 0 };
		let e = J(await this.db.rpc("claim_axom_email_jobs", { p_limit: 20 }));
		for (let t of e) try {
			if (t.first_attempt_at && Date.now() - Date.parse(t.first_attempt_at) > 23 * 36e5) throw Error("delivery-reconciliation-required");
			await this.sendAxomEmail(t);
		} catch (e) {
			let n = e instanceof q || e instanceof Error && [
				"delivery-reconciliation-required",
				"delivery-disabled-or-recipient-not-allowlisted",
				"verified-sender-required"
			].includes(e.message) ? e.message : "processing-failed", r = n !== "delivery-reconciliation-required" && t.attempts < 5 && (!(e instanceof q) || e.status === 429 || e.status >= 500);
			J(await this.db.from("email_jobs").update({
				status: r ? "queued" : "failed",
				failure_code: n,
				scheduled_for: new Date(Date.now() + 2 ** t.attempts * 6e4).toISOString()
			}).eq("id", t.id).eq("status", "processing")), J(await this.db.from("email_send_log").upsert({
				job_id: t.id,
				attempt: t.attempts,
				outcome: n
			}, { onConflict: "job_id,attempt" }));
		}
		return { processed: e.length };
	}
	async savePreferences(e, n, r) {
		if (!Array.isArray(n) || n.length !== Object.keys(t).length || new Set(n.map((e) => e.category)).size !== n.length) throw Error("Supply each email category once.");
		n.forEach(o);
		let i = (/* @__PURE__ */ new Date()).toISOString();
		J(await this.db.from("communication_preferences").upsert(n.map((t) => ({
			...t,
			user_id: e,
			updated_at: i,
			consent_at: t.enabled ? i : null
		})))), J(await this.db.from("communication_identity").upsert({
			user_id: e,
			...r ? {
				accent: s(r.accent),
				theme: r.theme === "light" ? "light" : "dark",
				locale: "en"
			} : {},
			topics_dirty: !0,
			updated_at: i
		}));
	}
	async schedule(e = /* @__PURE__ */ new Date()) {
		let t = 0, n = Y(await this.db.from("communication_worker_state").select("schedule_offset").eq("id", 1).single()).schedule_offset;
		{
			let r = J(await this.db.from("communication_preferences").select("*").eq("enabled", !0).order("user_id").order("category").range(n, n + 199));
			for (let n of r) {
				let r = p(n, e);
				if (!r) continue;
				let i = f(e, n.timezone), a;
				if ([
					"weekly_report",
					"monthly_report",
					"annual_pulse"
				].includes(n.category)) {
					let e = n.category === "weekly_report" ? "week" : n.category === "monthly_report" ? "month" : "year", t = e === "year" ? {
						start: `${r}-01-01`,
						end: `${r}-12-31`
					} : m(i.day, e), o = await this.snapshot(n.user_id, e, t.start, t.end, n.timezone);
					if (!o) continue;
					a = o.id;
				}
				let o = n.category === "annual_pulse" ? "pulse" : n.category === "exam_reminders" ? "exam_reminder" : n.category;
				if (o === "daily_learning") {
					let e = await this.workspace(n.user_id), r = e ? [...e.state.logs.map((e) => e.dayKey), ...fe(e.state.questions).map((e) => f(new Date(e.at), n.timezone).day)].sort().at(-1) : void 0;
					if (!r) continue;
					if (Date.parse(i.day) - Date.parse(r) >= 14 * 864e5) {
						o = "inactivity", await this.enqueue({
							userId: n.user_id,
							type: o,
							key: `${n.user_id}:inactivity:${i.day.slice(0, 7)}`
						}), t++;
						continue;
					}
				}
				if (o === "exam_reminder") {
					let e = (await this.context(n.user_id)).exam;
					if (!e || ![
						1,
						3,
						7,
						14
					].includes(e.days)) continue;
				}
				await this.enqueue({
					userId: n.user_id,
					type: o,
					key: `${n.user_id}:${o}:${r}`,
					snapshotId: a
				}), t++;
			}
			J(await this.db.from("communication_worker_state").update({ schedule_offset: r.length < 200 ? 0 : n + 200 }).eq("id", 1));
		}
		return t;
	}
	async syncTopics(e) {
		if (!this.env.RESEND_TOPIC_IDS || !this.env.RESEND_API_KEY || this.env.AXOM_EMAIL_MODE !== "live") return;
		let [t, n, r] = await Promise.all([
			this.user(e),
			this.preferenceRows(e),
			this.identity(e)
		]);
		if (!t.email_confirmed_at || !t.email) return;
		let i = JSON.parse(this.env.RESEND_TOPIC_IDS), a = n.filter((e) => i[e.category]).map((e) => ({
			id: i[e.category],
			subscription: e.enabled ? "opt_in" : "opt_out"
		})), o = r.contact_id;
		if (!o) {
			try {
				o = (await this.provider.request(`/contacts/${encodeURIComponent(t.email)}`)).id;
			} catch (e) {
				if (!(e instanceof q) || e.status !== 404) throw e;
			}
			o ||= (await this.provider.request("/contacts", "POST", {
				email: t.email,
				first_name: l(t.user_metadata?.display_name ?? ""),
				unsubscribed: !n.some((e) => e.enabled),
				topics: a
			})).id, J(await this.db.from("communication_identity").update({ contact_id: o }).eq("user_id", e));
		}
		await this.provider.request(`/contacts/${o}`, "PATCH", { unsubscribed: !n.some((e) => e.enabled) }), a.length && await this.provider.request(`/contacts/${o}/topics`, "PATCH", a), J(await this.db.from("communication_identity").update({
			topics_dirty: !1,
			topics_error: null
		}).eq("user_id", e).eq("updated_at", r.updated_at ?? ""));
	}
	async event(e, t) {
		let n = (/* @__PURE__ */ new Date()).toISOString(), r = await this.db.from("email_events").insert({
			provider_event_id: e,
			provider_id: t.data.email_id,
			type: t.type,
			event_at: t.created_at,
			payload: t
		});
		if (r.error?.code === "23505") {
			let t = Y(await this.db.from("email_events").select("processed_at,created_at").eq("provider_event_id", e).single());
			if (t.processed_at) return;
			n = t.created_at ?? n;
		} else J(r);
		if ([
			"email.bounced",
			"email.complained",
			"email.suppressed"
		].includes(t.type)) for (let e of t.data.to ?? []) J(await this.db.from("email_suppressions").upsert({
			email: e.toLowerCase(),
			reason: t.type
		}));
		let i = {
			"email.sent": "sent",
			"email.delivered": "delivered",
			"email.bounced": "bounced",
			"email.complained": "complained",
			"email.failed": "failed",
			"email.suppressed": "suppressed"
		};
		if (t.data.email_id && i[t.type]) {
			let e = i[t.type], r = this.db.from("email_jobs").update({ status: e }).eq("provider_id", t.data.email_id);
			if (r = e === "sent" ? r.in("status", [
				"processing",
				"queued",
				"sent"
			]) : e === "delivered" ? r.in("status", [
				"sent",
				"processing",
				"queued",
				"delivered"
			]) : e === "bounced" ? r.neq("status", "complained") : e === "suppressed" ? r.not("status", "in", "(bounced,complained)") : e === "failed" ? r.not("status", "in", "(bounced,complained,suppressed)") : r, J(await r), !J(await this.db.from("email_jobs").select("id").eq("provider_id", t.data.email_id).maybeSingle()) && Date.now() - Date.parse(n) < 15 * 6e4) return;
		}
		if (t.type.startsWith("contact.") && t.data.email) {
			let e = t.data.id ? { id: t.data.id } : await this.provider.request(`/contacts/${encodeURIComponent(t.data.email)}`), n = J(await this.db.from("communication_identity").select("user_id").eq("contact_id", e.id).maybeSingle());
			if (n) {
				t.data.unsubscribed === !0 && J(await this.db.from("communication_preferences").update({
					enabled: !1,
					updated_at: t.created_at
				}).eq("user_id", n.user_id).lte("updated_at", t.created_at));
				let e = JSON.parse(this.env.RESEND_TOPIC_IDS ?? "{}");
				for (let r of t.data.topics ?? []) {
					let i = Object.keys(e).find((t) => e[t] === r.id);
					i && r.subscription === "opt_out" && J(await this.db.from("communication_preferences").update({
						enabled: !1,
						updated_at: t.created_at
					}).eq("user_id", n.user_id).eq("category", i).lte("updated_at", t.created_at));
				}
			}
		}
		J(await this.db.from("email_events").update({ processed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("provider_event_id", e));
	}
	async exportRecord(e, t) {
		let n = Y(await this.db.from("privacy_requests").select("object_path,expires_at,status").eq("id", t).eq("user_id", e).eq("kind", "export").single());
		if (n.status !== "ready" || !n.object_path || Date.parse(n.expires_at) <= Date.now()) throw Error("export-expired-request-again");
		if (n.object_path !== `${e}/${t}.json`) throw Error("export-storage-index-invalid");
		return n;
	}
	async exportLink(e, t) {
		let n = await this.exportRecord(e, t);
		return Y(await this.db.storage.from("communications-exports").createSignedUrl(n.object_path, 900)).signedUrl;
	}
}, yt = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, bt = [
	"workspace-media",
	"workspace-content",
	"workspace-originals"
];
async function xt(e, t, n, r) {
	let i = e.db.storage.from(t), a = `${n}/`, o = [], s = /* @__PURE__ */ new Set(), c = /* @__PURE__ */ new Set(), l;
	for (;;) {
		let e = await i.listV2({
			prefix: a,
			limit: 100,
			...l ? { cursor: l } : {},
			sortBy: {
				column: "name",
				order: "asc"
			},
			with_delimiter: !1,
			noncurrentVersions: "include",
			deleteMarkers: "include"
		});
		if (e.error || !e.data || !Array.isArray(e.data.objects) || !Array.isArray(e.data.folders) || e.data.folders.length || typeof e.data.hasNext != "boolean") throw Error(`${r}-list-failed`);
		if (!e.data.objects.length && e.data.hasNext) throw Error(`${r}-cleanup-unconfirmed`);
		for (let t of e.data.objects) {
			if (!t || typeof t.name != "string") throw Error(`${r}-object-invalid`);
			let e = typeof t.key == "string" ? t.key : t.name.startsWith(a) ? t.name : `${a}${t.name}`;
			if (!e.startsWith(a) || e.length === a.length) throw Error(`${r}-object-invalid`);
			let n = typeof t.version == "string" && t.version ? {
				path: e,
				versionId: t.version
			} : e, i = JSON.stringify(n);
			if (s.has(i)) throw Error(`${r}-cleanup-unconfirmed`);
			s.add(i), o.push(n);
		}
		if (!e.data.hasNext) break;
		if (typeof e.data.nextCursor != "string" || !e.data.nextCursor || e.data.nextCursor === l || c.has(e.data.nextCursor)) throw Error(`${r}-cleanup-unconfirmed`);
		c.add(e.data.nextCursor), l = e.data.nextCursor;
	}
	return {
		bucketName: t,
		failureScope: r,
		prefix: n,
		removals: o
	};
}
async function St(e, t) {
	let n = e.db.storage.from(t.bucketName), r = t.removals, i = "";
	for (;;) {
		if (r.length) {
			let e = JSON.stringify(r);
			if (e === i) throw Error(`${t.failureScope}-cleanup-unconfirmed`);
			i = e;
			for (let e = 0; e < r.length; e += 100) if ((await n.remove(r.slice(e, e + 100))).error) throw Error(`${t.failureScope}-remove-failed`);
		}
		let a = await xt(e, t.bucketName, t.prefix, t.failureScope);
		if (!a.removals.length) return;
		r = a.removals;
	}
}
async function Ct(e, t) {
	for (let n of t) await St(e, n);
}
async function wt(e, t) {
	let n = [], r = /* @__PURE__ */ new Set(), i;
	for (let a = 0;; a += 500) {
		let o = await e.db.from("academic_collections").select("id", { count: "exact" }).eq("owner_id", t).order("id").range(a, a + 499);
		if (o.error || !Array.isArray(o.data) || typeof o.count != "number") throw Error("academic-storage-index-unavailable");
		if (i === void 0 && (i = o.count), o.count !== i) throw Error("academic-storage-index-changed");
		for (let e of o.data) {
			if (!e || typeof e.id != "string" || !yt.test(e.id) || r.has(e.id)) throw Error("academic-storage-index-invalid");
			r.add(e.id), n.push(e.id);
		}
		if (o.data.length < 500) break;
	}
	if (n.length !== i) throw Error("academic-storage-index-incomplete");
	let a = [];
	for (let t of n) a.push(await xt(e, "academic-content", t, "academic-storage"));
	return a;
}
async function Tt(e, t) {
	let n = /* @__PURE__ */ new Set(), r;
	for (let i = 0;; i += 500) {
		let a = await e.db.from("privacy_requests").select("id,object_path", { count: "exact" }).eq("user_id", t).not("object_path", "is", null).order("id").range(i, i + 499);
		if (a.error || !Array.isArray(a.data) || typeof a.count != "number") throw Error("export-storage-index-unavailable");
		if (r === void 0 && (r = a.count), a.count !== r) throw Error("export-storage-index-changed");
		for (let e of a.data) {
			if (!e || typeof e.id != "string" || !yt.test(e.id) || typeof e.object_path != "string" || n.has(e.id) || e.object_path !== `${t}/${e.id}.json`) throw Error("export-storage-index-invalid");
			n.add(e.id);
		}
		if (a.data.length < 500) break;
	}
	if (n.size !== r) throw Error("export-storage-index-incomplete");
	return xt(e, "communications-exports", t, "export-storage");
}
async function Et(e, t, n, r) {
	if ((await e.db.storage.from("communications-exports").remove([t])).error || !r) throw Error("export-deletion-reconciliation-required", { cause: n });
	try {
		if ((await xt(e, "communications-exports", t.slice(0, t.indexOf("/")), "export-storage")).removals.some((e) => (typeof e == "string" ? e : e.path) === t)) throw Error("export-storage-cleanup-unconfirmed");
	} catch (e) {
		throw Error("export-deletion-reconciliation-required", { cause: e });
	}
	throw n;
}
async function Dt(e, t, n) {
	let r = await e.user(t);
	if (!r.email_confirmed_at) throw Error("Verify your email before continuing.");
	let i = new Date(Date.now() + 7 * 864e5).toISOString(), a = await e.db.from("privacy_requests").insert({
		user_id: t,
		kind: n,
		status: n === "deletion" ? "scheduled" : "requested",
		scheduled_for: n === "deletion" ? i : null,
		notification_email: n === "deletion" ? r.email : null
	}).select("id").single();
	if (a.error?.code === "23505") {
		let r = (J(await e.db.from("privacy_requests").select("status,failure_code").eq("user_id", t).eq("kind", n).order("created_at", { ascending: !1 }).limit(20)) ?? []).find((e) => e.status === "failed");
		if (r) throw n === "deletion" && r.failure_code === "deletion-preflight-failed" ? Error("Cancel the existing failed deletion request before scheduling another.") : Error(`${n === "deletion" ? "Deletion" : "Export"} needs manual reconciliation before another request can be scheduled.`);
		return;
	}
	let o = Y(a);
	await e.enqueue({
		userId: t,
		type: n === "deletion" ? "deletion_requested" : "export_requested",
		key: `${o.id}:requested`,
		variables: { requestId: o.id }
	}), n === "deletion" && await e.enqueue({
		userId: t,
		type: "deletion_scheduled",
		key: `${o.id}:scheduled`,
		variables: { date: i }
	});
}
async function Ot(e, t, n) {
	let r = J(await e.db.from("privacy_requests").select("id,status,failure_code").eq("id", n).eq("user_id", t).eq("kind", "deletion").maybeSingle());
	if (!(r?.status === "scheduled" || r?.status === "failed" && r.failure_code === "deletion-preflight-failed")) throw Error("Deletion can no longer be cancelled, or it was already cancelled.");
	let i = e.db.from("privacy_requests").update({
		status: "cancelled",
		notification_email: null,
		failure_code: null
	}).eq("id", n).eq("user_id", t).eq("kind", "deletion").eq("status", r.status);
	r.status === "failed" && (i = i.eq("failure_code", "deletion-preflight-failed"));
	let a = J(await i.select("id").maybeSingle());
	if (!a) throw Error("Deletion can no longer be cancelled, or it was already cancelled.");
	await e.enqueue({
		userId: t,
		type: "deletion_cancelled",
		key: `${a.id}:cancelled`
	});
}
async function kt(e) {
	let t = (/* @__PURE__ */ new Date()).toISOString(), n = (/* @__PURE__ */ new Date(Date.now() - 15 * 6e4)).toISOString();
	J(await e.db.rpc("quarantine_stale_privacy_requests", { p_stale_before: n }));
	let r = J(await e.db.from("privacy_requests").select("*").in("status", ["requested", "scheduled"]).order("created_at").limit(10)), i = 0;
	for (let n of r ?? []) {
		if (n.kind === "deletion" && (n.scheduled_for > t || e.env.AXOM_ACCOUNT_DELETION_ENABLED !== "true") || !J(await e.db.rpc("claim_privacy_request", {
			p_request_id: n.id,
			p_now: t
		}))) continue;
		let r = !1;
		try {
			if (n.kind === "export") {
				let r = await e.workspace(n.user_id), [i, a, o, s, c, l] = await Promise.all([
					e.user(n.user_id),
					e.preferenceRows(n.user_id),
					e.identity(n.user_id),
					e.db.from("pulse_snapshots").select("*").eq("user_id", n.user_id),
					e.db.from("email_jobs").select("id,type,status,created_at,sent_at").eq("user_id", n.user_id),
					e.db.from("privacy_requests").select("id,kind,status,scheduled_for,created_at").eq("user_id", n.user_id)
				]), u = {
					format: "axom-account-export",
					version: 1,
					generatedAt: t,
					profile: {
						id: i.id,
						email: i.email,
						displayName: i.user_metadata?.display_name
					},
					preferences: a,
					emailPresentation: o,
					workspace: r?.state ?? null,
					workspaceUpdatedAt: r?.at ?? null,
					pulse: J(s),
					communications: J(c),
					privacy: J(l),
					coverage: "Account-held data only. Device-local source files, original PDFs and attachment binaries are not included. Use the local portable backup for device-owned content."
				}, d = `${n.user_id}/${n.id}.json`, f = JSON.stringify(u);
				if (new TextEncoder().encode(f).byteLength > 25e6) throw Error("export-too-large");
				try {
					J(await e.db.storage.from("communications-exports").upload(d, f, {
						contentType: "application/json",
						upsert: !0
					}));
				} catch (t) {
					await Et(e, d, t, !1);
				}
				let p = new Date(Date.now() + 7 * 864e5).toISOString(), m;
				try {
					m = J(await e.db.rpc("finalize_privacy_export", {
						p_request_id: n.id,
						p_object_path: d,
						p_expires_at: p
					}));
				} catch (e) {
					throw Error("export-deletion-reconciliation-required", { cause: e });
				}
				m || await Et(e, d, /* @__PURE__ */ Error("export-barrier-lost"), !0), await e.enqueue({
					userId: n.user_id,
					type: "export_ready",
					key: `${n.id}:ready`,
					variables: { requestId: n.id }
				});
			} else {
				let t = await Tt(e, n.user_id), i = await e.identity(n.user_id);
				if (i.contact_id && !e.env.RESEND_API_KEY) throw Error("provider-contact-deletion-unavailable");
				let a = J(await e.db.from("email_jobs").select("provider_id").eq("user_id", n.user_id).not("provider_id", "is", null)), o = await wt(e, n.user_id), s = await Promise.all(bt.map((t) => xt(e, t, n.user_id, "account-storage")));
				if (!J(await e.db.rpc("begin_account_deletion_cleanup", { p_request_id: n.id }))) throw Error("deletion-barrier-lost");
				if (r = !0, await St(e, t), i.contact_id) try {
					await e.provider.request(`/contacts/${i.contact_id}`, "DELETE");
				} catch (e) {
					if (!(e instanceof q) || e.status !== 404) throw Error("provider-contact-deletion-failed", { cause: e });
				}
				if (a?.length && J(await e.db.from("email_events").delete().in("provider_id", a.map((e) => e.provider_id))), await Ct(e, o), await Ct(e, s), (await e.db.auth.admin.deleteUser(n.user_id)).error) throw Error("account-deletion-failed");
				J(await e.db.from("privacy_requests").update({
					status: "completed",
					failure_code: null
				}).eq("id", n.id));
			}
			i++;
		} catch (t) {
			if (n.kind === "deletion") J(await e.db.rpc("record_account_deletion_failure", {
				p_request_id: n.id,
				p_requires_reconciliation: r
			}));
			else {
				let r = t instanceof Error && ["export-cancelled-for-deletion", "export-deletion-reconciliation-required"].includes(t.message) ? t.message : "privacy-processing-failed";
				J(await e.db.from("privacy_requests").update({
					status: "failed",
					failure_code: r
				}).eq("id", n.id).eq("status", "processing"));
			}
		}
	}
	let a = J(await e.db.from("privacy_requests").select("id,notification_email,completion_payload,completion_attempt_at,completion_attempts").eq("kind", "deletion").eq("status", "completed").eq("completed_email_sent", !1).is("failure_code", null).lte("completion_retry_at", t).not("notification_email", "is", null).limit(10));
	for (let t of a ?? []) if (!(!e.env.RESEND_API_KEY || !["live", "test"].includes(e.env.AXOM_EMAIL_MODE ?? ""))) try {
		if (!J(await e.db.from("email_suppressions").select("email").eq("email", t.notification_email.toLowerCase()).maybeSingle())) {
			if (t.completion_attempt_at && Date.now() - Date.parse(t.completion_attempt_at) > 23 * 36e5) {
				J(await e.db.from("privacy_requests").update({ failure_code: "receipt-reconciliation-required" }).eq("id", t.id));
				continue;
			}
			let n = t.completion_payload;
			if (!n) {
				let r = A({
					type: "deletion_completed",
					baseUrl: e.base,
					context: {
						displayName: "",
						accent: "#c8a96a",
						theme: "dark",
						locale: "en",
						timezone: "UTC",
						orbUrl: `${e.base}/icons/axom-orb-512.png`
					}
				});
				n = e.provider.prepare(t.notification_email, r), J(await e.db.from("privacy_requests").update({
					completion_payload: n,
					completion_attempt_at: (/* @__PURE__ */ new Date()).toISOString()
				}).eq("id", t.id));
			}
			await e.provider.sendPrepared(n, `${t.id}:completed`);
		}
		J(await e.db.from("privacy_requests").update({
			completed_email_sent: !0,
			notification_email: null,
			completion_payload: null
		}).eq("id", t.id));
	} catch {
		let n = t.completion_attempts + 1;
		J(await e.db.from("privacy_requests").update({
			completion_attempts: n,
			completion_retry_at: new Date(Date.now() + 2 ** n * 6e4).toISOString(),
			failure_code: n >= 5 ? "receipt-reconciliation-required" : null
		}).eq("id", t.id));
	}
	let o = J(await e.db.from("privacy_requests").select("id,user_id,object_path").eq("kind", "export").lt("expires_at", t).not("object_path", "is", null).limit(100));
	for (let t of o ?? []) {
		if (typeof t.id != "string" || !yt.test(t.id) || typeof t.user_id != "string" || t.object_path !== `${t.user_id}/${t.id}.json`) {
			J(await e.db.from("privacy_requests").update({ failure_code: "export-storage-index-invalid" }).eq("id", t.id));
			continue;
		}
		J(await e.db.storage.from("communications-exports").remove([t.object_path])), J(await e.db.from("privacy_requests").update({ object_path: null }).eq("id", t.id));
	}
	return J(await e.db.from("communication_tokens").delete().lt("expires_at", t)), J(await e.db.from("email_events").delete().lt("created_at", (/* @__PURE__ */ new Date(Date.now() - 30 * 864e5)).toISOString()).not("processed_at", "is", null)), J(await e.db.from("communication_rate_limits").delete().lt("window_start", (/* @__PURE__ */ new Date(Date.now() - 864e5)).toISOString())), i;
}
//#endregion
//#region web/src/lib/communications/server/campaigns.ts
function At(e) {
	if (!e || typeof e.title != "string" || !e.title.trim() || e.title.length > 180 || typeof e.excerpt != "string" || e.excerpt.length > 2e3 || (e.body?.length ?? 0) > 8e4 || (e.subject?.length ?? 0) > 180 || (e.preview?.length ?? 0) > 250) throw Error("Provide a title and a concise excerpt.");
	for (let t of [e.url, e.imageUrl].filter(Boolean)) if (new URL(t).protocol !== "https:") throw Error("Use HTTPS links.");
	if (e.readingMinutes !== void 0 && (!Number.isInteger(e.readingMinutes) || e.readingMinutes < 1 || e.readingMinutes > 120)) throw Error("Choose a reading time from 1 to 120 minutes.");
	for (let t of [
		e.title,
		e.excerpt,
		e.subject,
		e.preview,
		e.cta
	]) t && u(t, {
		displayName: "",
		accent: "#c8a96a",
		theme: "dark",
		locale: "en",
		timezone: "UTC",
		orbUrl: "https://axom.info/icons/axom-orb-512.png"
	});
	return e;
}
function jt(e) {
	if (!e || ![
		"subscribers",
		"selected",
		"course"
	].includes(e.kind)) throw Error("Choose an audience.");
	if (e.kind === "selected" && (!e.userIds?.length || e.userIds.length > 100 || e.userIds.some((e) => !/^[0-9a-f-]{36}$/i.test(e)))) throw Error("Choose 1 to 100 account IDs.");
	if (e.kind === "course" && (!e.courseId || e.courseId.length > 100)) throw Error("Choose a canonical course ID.");
}
async function Mt(e, t, r, i) {
	jt(r);
	let a = e.db.from("communication_preferences").select("user_id").eq("category", n[t]).eq("enabled", !0).order("user_id").limit(200);
	i && (a = a.gt("user_id", i)), r.kind === "selected" && (a = a.in("user_id", r.userIds));
	let o = (J(await a) ?? []).map((e) => e.user_id), s = [];
	for (let t of o) {
		if (r.kind === "course" && !(await e.workspace(t))?.state.courses.some((e) => e.id === r.courseId)) continue;
		let n = await e.user(t);
		!n.email_confirmed_at || !n.email || J(await e.db.from("email_suppressions").select("email").eq("email", n.email.toLowerCase()).maybeSingle()) || J(await e.db.from("privacy_requests").select("id").eq("user_id", t).eq("kind", "deletion").in("status", [
			"scheduled",
			"processing",
			"failed"
		]).limit(1))?.length || s.push(t);
	}
	return {
		scanned: o,
		eligible: s
	};
}
async function Nt(e) {
	let t = J(await e.db.from("email_campaigns").select("*").eq("status", "scheduled").lte("scheduled_for", (/* @__PURE__ */ new Date()).toISOString()).order("created_at").limit(2)), n = 0;
	for (let r of t ?? []) {
		let t = await Mt(e, r.type, r.audience, r.cursor ?? void 0);
		for (let n of t.eligible) await e.enqueue({
			userId: n,
			type: r.type,
			key: `${r.id}:${n}`,
			campaignId: r.id,
			variables: { editorial: r.content }
		});
		J(await e.db.from("email_campaigns").update({
			cursor: t.scanned.at(-1) ?? r.cursor,
			recipient_count: r.recipient_count + t.eligible.length,
			status: t.scanned.length < 200 ? "queued" : "scheduled"
		}).eq("id", r.id).eq("status", "scheduled")), n += t.eligible.length;
	}
	return n;
}
//#endregion
//#region web/src/lib/communications/server/handler.ts
var X = class extends Error {
	status;
	constructor(e, t = 400) {
		super(e), this.status = t;
	}
}, Pt = new Set([
	"admin",
	"campaign-save",
	"campaign-estimate",
	"campaign-schedule",
	"campaign-cancel",
	"send-test",
	"broadcast-export",
	"article-publish"
]), Ft = [
	"essay",
	"product_update",
	"research",
	"marketing"
], Z = (e, t = 200, n = {}) => new Response(JSON.stringify(e), {
	status: t,
	headers: {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		...n
	}
});
function It(e, t) {
	return (t.AXOM_COMMUNICATIONS_ADMINS ?? "").split(",").map((e) => e.trim()).includes(e.id);
}
function Lt(e) {
	try {
		return !!JSON.parse(atob(e.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).amr?.some((e) => Date.now() / 1e3 - e.timestamp >= 0 && Date.now() / 1e3 - e.timestamp <= 600);
	} catch {
		return !1;
	}
}
function Rt(e, t, r) {
	let i = new vt(e, t, r);
	return async (r) => {
		let a = r.headers.get("origin"), o = (t.AXOM_ALLOWED_ORIGINS ?? t.AXOM_PUBLIC_URL ?? "https://axom.info").split(",").map((e) => e.trim()), s = a && o.includes(a) ? {
			"Access-Control-Allow-Origin": a,
			Vary: "Origin",
			"Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info",
			"Access-Control-Allow-Methods": "POST,GET,OPTIONS"
		} : {};
		if (r.method === "OPTIONS") return new Response(null, {
			status: a && !o.includes(a) ? 403 : 204,
			headers: s
		});
		try {
			let c = new URL(r.url), l = c.searchParams.get("action") ?? "settings";
			if (l === "unsubscribe") {
				let t = c.searchParams.get("token") ?? "";
				if (!/^[0-9a-f]{64}$/.test(t)) throw new X("This unsubscribe link is invalid.");
				let n = J(await e.from("communication_tokens").select("user_id,category").eq("token_hash", await gt(t)).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).maybeSingle());
				if (!n) throw new X("This link has expired. Sign in to AXOM to manage email preferences.");
				if (r.method === "GET") return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>AXOM email preferences</title><body style=\"background:#0d0d0e;color:#e6e2d6;font:18px system-ui;max-width:560px;margin:12vh auto;padding:24px\"><h1>A quieter inbox.</h1><p>Unsubscribe from this email category. Essential account and security emails remain enabled.</p><form method=\"post\"><button style=\"padding:16px 24px;font:inherit\">Confirm unsubscribe</button></form></body></html>", { headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
					"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
					"Referrer-Policy": "no-referrer"
				} });
				if (r.method !== "POST") throw new X("Method not allowed", 405);
				return J(await e.from("communication_preferences").update({
					enabled: !1,
					updated_at: (/* @__PURE__ */ new Date()).toISOString()
				}).eq("user_id", n.user_id).eq("category", n.category)), J(await e.from("communication_identity").upsert({
					user_id: n.user_id,
					topics_dirty: !0,
					updated_at: (/* @__PURE__ */ new Date()).toISOString()
				})), new Response("You are unsubscribed from this category. Essential account emails remain enabled.", { headers: {
					"Content-Type": "text/plain",
					"Cache-Control": "no-store"
				} });
			}
			if (l === "webhook") {
				if (r.method !== "POST" || !t.RESEND_WEBHOOK_SECRET) throw new X("Webhook unavailable", 503);
				let e = await r.text();
				if (e.length > 1e5) throw new X("Payload too large", 413);
				let n;
				try {
					n = await _t(e, r.headers, t.RESEND_WEBHOOK_SECRET);
				} catch {
					throw new X("Invalid webhook signature", 401);
				}
				return await i.event(r.headers.get("svix-id"), n), Z({ received: !0 });
			}
			if (r.method !== "POST") throw new X("Method not allowed", 405);
			if (a && !o.includes(a)) throw new X("Origin not allowed", 403);
			let u = r.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
			if (l === "worker") {
				if (!t.AXOM_COMMUNICATIONS_CRON_SECRET || await gt(u) !== await gt(t.AXOM_COMMUNICATIONS_CRON_SECRET)) throw new X("Unauthorized", 401);
				let n = J(await e.rpc("acquire_communication_worker"));
				if (!n) return Z({ busy: !0 });
				try {
					let t = await i.schedule(), n = await Nt(i), r = await kt(i), a = await i.work(), o = J(await e.from("communication_identity").select("user_id").eq("topics_dirty", !0).limit(20));
					for (let t of o ?? []) try {
						await i.syncTopics(t.user_id);
					} catch {
						J(await e.from("communication_identity").update({ topics_error: "Synchronization will retry." }).eq("user_id", t.user_id));
					}
					let s = J(await e.from("email_events").select("provider_event_id,payload").is("processed_at", null).order("created_at").limit(50));
					for (let e of s ?? []) await i.event(e.provider_event_id, e.payload);
					let c = J(await e.from("email_campaigns").select("id").eq("status", "queued").limit(30)) ?? [];
					for (let t of c) J(await e.from("email_jobs").select("id").eq("campaign_id", t.id).in("status", [
						"queued",
						"scheduled",
						"processing"
					]).limit(1))?.length || J(await e.from("email_campaigns").update({ status: "completed" }).eq("id", t.id).eq("status", "queued"));
					return Z({
						queued: t,
						campaigns: n,
						privacy: r,
						...a
					});
				} finally {
					J(await e.from("communication_worker_state").update({
						lease: null,
						expires_at: (/* @__PURE__ */ new Date()).toISOString()
					}).eq("id", 1).eq("lease", n));
				}
			}
			if (!u) throw new X("Sign in to manage your account communications.", 401);
			let d = await e.auth.getUser(u);
			if (d.error || !d.data.user) throw new X("Sign in again to continue.", 401);
			let f = d.data.user;
			if (Pt.has(l) && !It(f, t)) throw new X("Administrator access required.", 403);
			if (!J(await e.rpc("consume_communication_limit", {
				p_key: `${f.id}:${l}`,
				p_limit: l.startsWith("request-") ? 3 : 60,
				p_seconds: 3600
			}))) throw new X("Too many requests. Try again later.", 429);
			let p = await r.text();
			if (p.length > 1e5) throw new X("Payload too large", 413);
			let m;
			try {
				if (m = p ? JSON.parse(p) : {}, !m || Array.isArray(m) || typeof m != "object") throw Error();
			} catch {
				throw new X("Invalid request body");
			}
			if (l === "settings") {
				let [n, r, a, o] = await Promise.all([
					i.preferenceRows(f.id),
					i.identity(f.id),
					e.from("email_jobs").select("id,type,status,sent_at,created_at,failure_code").eq("user_id", f.id).order("created_at", { ascending: !1 }).limit(30),
					e.from("privacy_requests").select("id,kind,status,scheduled_for,expires_at,created_at,failure_code").eq("user_id", f.id).order("created_at", { ascending: !1 }).limit(20)
				]);
				return Z({
					preferences: n,
					identity: r,
					history: J(a),
					privacy: J(o),
					admin: It(f, t),
					deliveryMode: t.AXOM_EMAIL_MODE ?? "disabled",
					deletionEnabled: t.AXOM_ACCOUNT_DELETION_ENABLED === "true",
					hasProtectedCopy: !!await i.workspace(f.id)
				}, 200, s);
			}
			if (l === "preferences") return await i.savePreferences(f.id, m.preferences, m.identity), Z({ saved: !0 }, 200, s);
			if (l === "unsubscribe-all") {
				let e = await i.preferenceRows(f.id);
				return await i.savePreferences(f.id, e.map((e) => ({
					...e,
					enabled: !1
				}))), Z({ saved: !0 }, 200, s);
			}
			if (l === "request-export") return await Dt(i, f.id, "export"), Z({ requested: !0 }, 200, s);
			if (l === "export-link") return Z({ url: await i.exportLink(f.id, String(m.id)) }, 200, s);
			if (l === "request-deletion") {
				if (t.AXOM_ACCOUNT_DELETION_ENABLED !== "true") throw new X("Account deletion activation is pending. Your account has not been changed.", 503);
				if (m.confirmation !== "DELETE MY ACCOUNT" || !Lt(u)) throw new X("Sign in again, then type DELETE MY ACCOUNT to confirm.", 403);
				return await Dt(i, f.id, "deletion"), Z({ requested: !0 }, 200, s);
			}
			if (l === "cancel-deletion") return await Ot(i, f.id, String(m.id)), Z({ cancelled: !0 }, 200, s);
			if (l === "pulse") {
				let e = Number(m.year);
				if (!Number.isInteger(e) || e < 2020 || e > (/* @__PURE__ */ new Date()).getUTCFullYear()) throw new X("Choose a valid year.");
				let t = await i.context(f.id), n = e === (/* @__PURE__ */ new Date()).getUTCFullYear() ? zt(t.timezone) : `${e}-12-31`;
				return Z({ snapshot: (await i.snapshot(f.id, "year", `${e}-01-01`, n, t.timezone))?.payload ?? null }, 200, s);
			}
			if (l === "admin") return Z({
				campaigns: J(await e.from("email_campaigns").select("*").order("created_at", { ascending: !1 }).limit(50)),
				failures: J(await e.from("email_jobs").select("id,type,status,failure_code,created_at").in("status", [
					"failed",
					"bounced",
					"complained"
				]).order("created_at", { ascending: !1 }).limit(30)),
				deliveryMode: t.AXOM_EMAIL_MODE ?? "disabled"
			}, 200, s);
			if (l === "campaign-save") {
				let t = String(m.type);
				if (!Ft.includes(t)) throw new X("Choose an editorial or product template.");
				let n = At(m.content), r = m.audience;
				jt(r);
				let a = typeof m.id == "string" ? m.id : crypto.randomUUID();
				if (m.id && Y(await e.from("email_campaigns").select("status").eq("id", a).single()).status !== "draft") throw new X("Only drafts can be edited.");
				let o = {
					type: t,
					content: n,
					audience: r,
					created_by: f.id,
					status: "draft"
				};
				if (m.id ? Y(await e.from("email_campaigns").update(o).eq("id", a).eq("status", "draft").select("id").single()) : J(await e.from("email_campaigns").insert({
					id: a,
					...o
				})), t === "essay" && n.body) {
					let t = Y(await e.from("axom_articles").upsert({
						campaign_id: a,
						title: n.title,
						excerpt: n.excerpt,
						body: n.body,
						reading_minutes: n.readingMinutes ?? null
					}, { onConflict: "campaign_id" }).select("id").single());
					n.url = `${i.base}/#essay?id=${t.id}`, J(await e.from("email_campaigns").update({ content: n }).eq("id", a));
				}
				return Z({
					id: a,
					content: n
				}, 200, s);
			}
			if ([
				"campaign-estimate",
				"campaign-schedule",
				"campaign-cancel",
				"broadcast-export",
				"article-publish"
			].includes(l)) {
				let t = Y(await e.from("email_campaigns").select("*").eq("id", String(m.id)).single());
				if (l === "campaign-cancel") return J(await e.from("email_campaigns").update({ status: "cancelled" }).eq("id", t.id)), J(await e.from("email_jobs").update({ status: "cancelled" }).eq("campaign_id", t.id).in("status", ["queued", "scheduled"])), Z({ cancelled: !0 }, 200, s);
				if (l === "campaign-estimate") {
					let e = await Mt(i, t.type, t.audience);
					return Z({
						eligible: e.eligible.length,
						more: e.scanned.length === 200
					}, 200, s);
				}
				if (l === "article-publish") {
					if (t.type !== "essay" || m.confirmation !== "PUBLISH ESSAY") throw new X("Review the essay and type PUBLISH ESSAY.");
					return Y(await e.from("axom_articles").update({ published_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("campaign_id", t.id).select("id").single()), Z({
						published: !0,
						url: t.content.url
					}, 200, s);
				}
				if (l === "broadcast-export") {
					if (t.type === "essay" && t.content.body) {
						let n = Y(await e.from("axom_articles").select("published_at").eq("campaign_id", t.id).single());
						if (!n.published_at || Date.parse(n.published_at) > Date.now()) throw new X("Publish the canonical essay before exporting its delivery email.");
					}
					let n = {
						...await i.context(f.id),
						displayName: "",
						course: void 0,
						exam: void 0
					}, r = A({
						type: t.type,
						editorial: t.content,
						context: n,
						baseUrl: i.base,
						unsubscribeUrl: "https://axom.invalid/broadcast-unsubscribe"
					});
					return Z({
						...r,
						html: r.html.replaceAll("https://axom.invalid/broadcast-unsubscribe", "{{{RESEND_UNSUBSCRIBE_URL}}}"),
						text: r.text.replaceAll("https://axom.invalid/broadcast-unsubscribe", "{{{RESEND_UNSUBSCRIBE_URL}}}"),
						note: "Import into a Resend Broadcast and choose the matching opt-in Topic. This generic version omits private course/exam personalization. Do not also schedule this draft in AXOM."
					}, 200, s);
				}
				if (m.confirmation !== "SCHEDULE EMAIL" || t.status !== "draft") throw new X("Review the draft and type SCHEDULE EMAIL.");
				let n = String(m.scheduledFor);
				if (!Number.isFinite(Date.parse(n)) || Date.parse(n) < Date.now() + 6e4) throw new X("Schedule at least one minute in the future.");
				if (!J(await e.rpc("schedule_axom_campaign", {
					p_id: t.id,
					p_at: n
				}))) throw new X("The draft changed. Reload and review it again.");
				return Z({ scheduled: !0 }, 200, s);
			}
			if (l === "send-test") {
				let e = String(m.type);
				if (!Object.hasOwn(n, e) || e.startsWith("deletion") || e.startsWith("export") || e === "auth" || e === "security") throw new X("This template cannot be test-triggered here.");
				let t = m.content ? At(m.content) : void 0;
				return await i.enqueue({
					userId: f.id,
					type: e,
					key: `test:${f.id}:${crypto.randomUUID()}`,
					variables: {
						editorial: t,
						test: !0
					}
				}), Z({
					queued: !0,
					note: "Test queued for your verified, allowlisted account. Consent and suppression still apply."
				}, 200, s);
			}
			throw new X("Unknown action", 404);
		} catch (e) {
			return Z({ error: e instanceof X || e instanceof Error && !["database-operation-failed"].includes(e.message) && e.message.length < 160 ? e.message : "This request could not be completed. Try again or contact the operator." }, e instanceof X ? e.status : 400, s);
		}
	};
}
function zt(e) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: e,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(/* @__PURE__ */ new Date());
}
//#endregion
export { n as TEMPLATE_CATEGORY, Rt as createCommunicationsHandler, i as preferences, A as renderAxomEmail };
