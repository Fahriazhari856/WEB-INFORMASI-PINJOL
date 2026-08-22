(function () {
    "use strict";

    const ADMIN_API = "/api/admin";
    const AUTH_API = "/api/auth";
    const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    const SECTION_META = Object.freeze({
        dashboard: ["Dashboard", "Ringkasan aktivitas sistem"],
        companies: ["Data Pinjol", "Kelola informasi pinjaman online yang tampil ke publik"],
        users: ["Akun", "Kelola akses, peran, status, dan keamanan akun"],
        reviews: ["Ulasan", "Moderasi ulasan sebelum atau sesudah dipublikasikan"],
        reports: ["Laporan", "Tindak lanjuti laporan yang dikirim pengguna"],
        settings: ["Pengaturan", "Atur konten utama yang ditampilkan pada halaman pengguna"],
        audit: ["Audit Log", "Riwayat tindakan administratif (hanya-baca)"]
    });

    const state = {
        user: null,
        csrfToken: "",
        section: "dashboard",
        renderEpoch: 0,
        csrfPromise: null,
        sidebarOpen: false,
        confirmResolver: null,
        editorSubmit: null,
        users: { search: "", role: "", status: "", sequence: 0 },
        companies: { search: "", status: "", publicationStatus: "" },
        reviews: { status: "" },
        reports: { status: "" },
        audit: { search: "" }
    };

    const dom = {};
    let userSearchTimer = null;

    class ApiError extends Error {
        constructor(message, status, payload) {
            super(message);
            this.name = "ApiError";
            this.status = status;
            this.payload = payload;
        }
    }

    function cacheDom() {
        [
            "login-view", "login-form", "login-email", "login-password", "login-submit", "login-error",
            "admin-app", "sidebar", "sidebar-backdrop", "menu-button", "change-password-button", "logout-button", "refresh-button",
            "admin-content", "page-title", "page-subtitle", "admin-name", "admin-email", "admin-avatar",
            "editor-dialog", "editor-form", "editor-title", "editor-eyebrow", "editor-fields", "editor-error",
            "editor-submit", "editor-cancel", "editor-close", "confirm-dialog", "confirm-form", "confirm-title",
            "confirm-message", "confirm-submit", "confirm-cancel", "confirm-close", "toast-region"
        ].forEach((id) => {
            dom[toCamelCase(id)] = document.getElementById(id);
        });
    }

    function toCamelCase(value) {
        return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    }

    function element(tag, options, children) {
        const node = document.createElement(tag);
        const props = options || {};

        if (props.className) node.className = props.className;
        if (props.text !== undefined && props.text !== null) node.textContent = String(props.text);
        if (props.title) node.title = String(props.title);
        if (props.type) node.type = props.type;
        if (props.name) node.name = props.name;
        if (props.value !== undefined && props.value !== null) node.value = String(props.value);
        if (props.id) node.id = props.id;
        if (props.hidden !== undefined) node.hidden = Boolean(props.hidden);
        if (props.disabled !== undefined) node.disabled = Boolean(props.disabled);
        if (props.required !== undefined) node.required = Boolean(props.required);
        if (props.checked !== undefined) node.checked = Boolean(props.checked);
        if (props.placeholder) node.placeholder = String(props.placeholder);
        if (props.href) node.href = props.href;
        if (props.target) node.target = props.target;
        if (props.rel) node.rel = props.rel;
        if (props.colSpan) node.colSpan = props.colSpan;
        if (props.scope) node.scope = props.scope;

        if (props.attrs) {
            Object.entries(props.attrs).forEach(([key, value]) => {
                if (value !== undefined && value !== null) node.setAttribute(key, String(value));
            });
        }
        if (props.dataset) {
            Object.entries(props.dataset).forEach(([key, value]) => {
                if (value !== undefined && value !== null) node.dataset[key] = String(value);
            });
        }
        if (props.on) {
            Object.entries(props.on).forEach(([eventName, handler]) => node.addEventListener(eventName, handler));
        }

        const childList = Array.isArray(children) ? children : children ? [children] : [];
        childList.forEach((child) => {
            if (child === null || child === undefined || child === false) return;
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return node;
    }

    function replaceContent(children) {
        const list = Array.isArray(children) ? children : [children];
        dom.adminContent.replaceChildren(...list.filter(Boolean));
    }

    function plainValue(value, fallback) {
        if (value === null || value === undefined || value === "") return fallback === undefined ? "—" : fallback;
        return String(value);
    }

    function entityId(item) {
        if (!item || typeof item !== "object") return "";
        return item.id ?? item._id ?? item.uuid ?? "";
    }

    function ownValue(object, keys, fallback) {
        const source = object && typeof object === "object" ? object : {};
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
                return source[key];
            }
        }
        return fallback;
    }

    function nestedName(value, fallback) {
        if (value && typeof value === "object") {
            return plainValue(ownValue(value, ["name", "fullName", "email", "title"], fallback), fallback);
        }
        return plainValue(value, fallback);
    }

    function unwrapPayload(payload) {
        if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, "data")) {
            return payload.data;
        }
        return payload;
    }

    function listFromPayload(payload, keys) {
        const unwrapped = unwrapPayload(payload);
        if (Array.isArray(unwrapped)) return unwrapped;
        if (!unwrapped || typeof unwrapped !== "object") return [];

        const candidates = [...(keys || []), "items", "results", "rows"];
        for (const key of candidates) {
            if (Array.isArray(unwrapped[key])) return unwrapped[key];
        }
        if (unwrapped.data && typeof unwrapped.data === "object") {
            if (Array.isArray(unwrapped.data)) return unwrapped.data;
            for (const key of candidates) {
                if (Array.isArray(unwrapped.data[key])) return unwrapped.data[key];
            }
        }
        return [];
    }

    function objectFromPayload(payload, keys) {
        const unwrapped = unwrapPayload(payload);
        if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return {};
        for (const key of keys || []) {
            if (unwrapped[key] && typeof unwrapped[key] === "object" && !Array.isArray(unwrapped[key])) return unwrapped[key];
        }
        return unwrapped;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return plainValue(value);
        return new Intl.DateTimeFormat("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Makassar"
        }).format(date);
    }

    function formatDateTimeLocal(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const offset = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    function formatNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return plainValue(value, "0");
        return new Intl.NumberFormat("id-ID").format(number);
    }

    function safeHttpUrl(value) {
        if (!value) return "";
        try {
            const url = new URL(String(value), window.location.origin);
            if (url.protocol !== "http:" && url.protocol !== "https:") return "";
            return url.href;
        } catch (_error) {
            return "";
        }
    }

    function getCookieCsrf() {
        const accepted = new Set(["csrfToken", "csrf-token", "_csrf", "XSRF-TOKEN", "pinjol_csrf"]);
        const pairs = document.cookie ? document.cookie.split(";") : [];
        for (const pair of pairs) {
            const separator = pair.indexOf("=");
            const rawName = separator >= 0 ? pair.slice(0, separator).trim() : pair.trim();
            if (!accepted.has(rawName)) continue;
            const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
            try {
                return decodeURIComponent(rawValue);
            } catch (_error) {
                return rawValue;
            }
        }
        return "";
    }

    function captureCsrf(payload, headers) {
        const source = payload && typeof payload === "object" ? payload : {};
        const data = source.data && typeof source.data === "object" ? source.data : {};
        const token = ownValue(source, ["csrfToken", "csrf", "csrf_token"], "")
            || ownValue(data, ["csrfToken", "csrf", "csrf_token"], "")
            || (headers && (headers.get("X-CSRF-Token") || headers.get("X-XSRF-Token")))
            || getCookieCsrf();
        if (token) state.csrfToken = String(token);
    }

    function apiMessage(payload, fallback) {
        if (!payload) return fallback;
        if (typeof payload === "string") return payload.slice(0, 500) || fallback;
        const unwrapped = unwrapPayload(payload);
        const sources = [payload, unwrapped].filter((item) => item && typeof item === "object");
        for (const source of sources) {
            if (source.error && typeof source.error === "object") {
                const nestedMessage = ownValue(source.error, ["message", "detail"], "");
                if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage.trim().slice(0, 500);
                const nestedCode = ownValue(source.error, ["code"], "");
                if (typeof nestedCode === "string" && nestedCode.trim()) return nestedCode.trim().slice(0, 160);
            }
            const message = ownValue(source, ["message", "error", "detail"], "");
            if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
            if (Array.isArray(source.errors) && source.errors.length) {
                const first = source.errors[0];
                if (typeof first === "string") return first.slice(0, 500);
                if (first && typeof first.message === "string") return first.message.slice(0, 500);
            }
        }
        return fallback;
    }

    async function parseResponse(response) {
        if (response.status === 204) return null;
        const type = response.headers.get("content-type") || "";
        if (type.includes("application/json")) {
            try {
                return await response.json();
            } catch (_error) {
                return null;
            }
        }
        try {
            return await response.text();
        } catch (_error) {
            return null;
        }
    }

    async function refreshCsrf() {
        if (state.csrfPromise) return state.csrfPromise;
        state.csrfPromise = (async () => {
            try {
                const response = await fetch(`${AUTH_API}/me`, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                    cache: "no-store"
                });
                const payload = await parseResponse(response);
                captureCsrf(payload, response.headers);
            } catch (_error) {
                const cookieToken = getCookieCsrf();
                if (cookieToken) state.csrfToken = cookieToken;
            } finally {
                state.csrfPromise = null;
            }
            return state.csrfToken;
        })();
        return state.csrfPromise;
    }

    async function apiRequest(path, options) {
        const config = options || {};
        const method = String(config.method || "GET").toUpperCase();
        const mutating = MUTATING_METHODS.has(method);
        if (mutating && !state.csrfToken) await refreshCsrf();

        const headers = new Headers(config.headers || {});
        headers.set("Accept", "application/json");
        if (mutating) headers.set("X-CSRF-Token", state.csrfToken || getCookieCsrf() || "");

        let body = config.body;
        if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== "string") {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(body);
        }

        const response = await fetch(path, {
            method,
            headers,
            body,
            signal: config.signal,
            credentials: "same-origin",
            cache: method === "GET" ? "no-store" : "default"
        });
        const payload = await parseResponse(response);
        captureCsrf(payload, response.headers);

        if (!response.ok) {
            const errorCode = payload && payload.error && payload.error.code
                ? payload.error.code
                : payload && payload.code ? payload.code : "";
            if (
                response.status === 401
                && errorCode === "AUTH_REQUIRED"
                && config.redirectOnUnauthorized !== false
                && state.user
            ) {
                forceLogin("Sesi Anda telah berakhir. Silakan masuk kembali.");
            }
            const fallback = response.status === 403
                ? "Anda tidak memiliki izin untuk melakukan tindakan ini."
                : `Permintaan gagal (${response.status}).`;
            throw new ApiError(apiMessage(payload, fallback), response.status, payload);
        }
        return payload;
    }

    function getUser(payload) {
        const unwrapped = unwrapPayload(payload);
        if (!unwrapped || typeof unwrapped !== "object") return null;
        if (unwrapped.user && typeof unwrapped.user === "object") return unwrapped.user;
        if (unwrapped.account && typeof unwrapped.account === "object") return unwrapped.account;
        if (ownValue(unwrapped, ["email", "role", "name"], null) !== null) return unwrapped;
        return null;
    }

    function isAdmin(user) {
        if (!user || typeof user !== "object") return false;
        if (user.isAdmin === true) return true;
        const role = String(ownValue(user, ["role", "userRole"], "")).toLowerCase();
        if (["admin", "superadmin", "super_admin"].includes(role)) return true;
        if (Array.isArray(user.roles)) {
            return user.roles.some((item) => ["admin", "superadmin", "super_admin"].includes(String(item).toLowerCase()));
        }
        return false;
    }

    function setButtonBusy(button, busy, label) {
        if (!button) return;
        button.disabled = Boolean(busy);
        const spinner = button.querySelector(".spinner");
        const labelNode = button.querySelector(".button__label");
        if (spinner) spinner.hidden = !busy;
        if (labelNode && label) labelNode.textContent = label;
        button.setAttribute("aria-busy", String(Boolean(busy)));
    }

    function showInlineError(container, message) {
        container.textContent = plainValue(message, "Terjadi kesalahan.");
        container.hidden = false;
    }

    function clearInlineError(container) {
        container.textContent = "";
        container.hidden = true;
    }

    function toast(message, type) {
        const variant = type || "info";
        const item = element("div", {
            className: `toast${variant === "success" ? " toast--success" : variant === "error" ? " toast--error" : ""}`,
            attrs: { role: variant === "error" ? "alert" : "status" }
        });
        const icon = element("span", {
            className: "toast__icon",
            text: variant === "success" ? "✓" : variant === "error" ? "!" : "i",
            attrs: { "aria-hidden": "true" }
        });
        const copy = element("span", { className: "toast__text", text: plainValue(message) });
        const close = element("button", {
            className: "toast__close",
            text: "×",
            type: "button",
            attrs: { "aria-label": "Tutup notifikasi" },
            on: { click: () => item.remove() }
        });
        item.append(icon, copy, close);
        dom.toastRegion.append(item);
        window.setTimeout(() => item.remove(), variant === "error" ? 7000 : 4500);
    }

    function loadingState(message) {
        return element("div", { className: "loading-state", attrs: { role: "status" } }, [
            element("span", { className: "spinner", attrs: { "aria-hidden": "true" } }),
            element("span", { text: message || "Memuat data…" })
        ]);
    }

    function emptyState(title, message) {
        return element("div", { className: "empty-state" }, [
            element("span", { className: "empty-state__icon", text: "∅", attrs: { "aria-hidden": "true" } }),
            element("h2", { text: title || "Belum ada data" }),
            element("p", { text: message || "Data akan muncul di sini setelah tersedia." })
        ]);
    }

    function renderError(error, retry) {
        if (error && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Tidak dapat memuat data.";
        const wrapper = element("div", { className: "error-state" }, [
            element("span", { className: "error-state__icon", text: "!", attrs: { "aria-hidden": "true" } }),
            element("h2", { text: "Data gagal dimuat" }),
            element("p", { text: message })
        ]);
        if (typeof retry === "function") {
            wrapper.append(element("button", {
                className: "button button--primary",
                text: "Coba lagi",
                type: "button",
                on: { click: retry }
            }));
        }
        replaceContent(wrapper);
    }

    function badge(value, override) {
        const normalized = String(value || "").toLowerCase();
        const success = ["active", "legal", "approved", "published", "resolved", "success", "sukses"];
        const danger = ["blocked", "ilegal", "illegal", "rejected", "failed", "gagal"];
        const warning = ["pending", "new", "draft", "reviewing", "in_review", "suspended"];
        const info = ["admin", "featured"];
        const purple = ["hidden", "archived", "superadmin", "super_admin"];
        let variant = override || "neutral";
        if (!override) {
            if (success.includes(normalized)) variant = "success";
            else if (danger.includes(normalized)) variant = "danger";
            else if (warning.includes(normalized)) variant = "warning";
            else if (info.includes(normalized)) variant = "info";
            else if (purple.includes(normalized)) variant = "purple";
        }
        return element("span", { className: `badge badge--${variant}`, text: plainValue(value) });
    }

    function makePanel(title, subtitle, action) {
        const panel = element("section", { className: "panel" });
        const headingCopy = element("div", {}, [
            element("h2", { text: title }),
            subtitle ? element("p", { text: subtitle }) : null
        ]);
        const header = element("header", { className: "panel__header" }, [headingCopy, action || null]);
        panel.append(header);
        return panel;
    }

    function makeTable(headers) {
        const table = element("table", { className: "data-table" });
        const thead = element("thead");
        const headerRow = element("tr");
        headers.forEach((label) => headerRow.append(element("th", { text: label, scope: "col" })));
        thead.append(headerRow);
        const tbody = element("tbody");
        table.append(thead, tbody);
        const wrap = element("div", { className: "table-wrap" }, table);
        return { wrap, table, tbody };
    }

    function tableCell(content, className) {
        const cell = element("td", { className: className || "" });
        if (content instanceof Node) cell.append(content);
        else cell.textContent = plainValue(content);
        return cell;
    }

    function emptyTableRow(tbody, colSpan, message) {
        const row = element("tr");
        const cell = element("td", { colSpan });
        cell.append(element("div", { className: "empty-state" }, [
            element("span", { className: "empty-state__icon", text: "∅", attrs: { "aria-hidden": "true" } }),
            element("strong", { text: message || "Tidak ada data." })
        ]));
        row.append(cell);
        tbody.append(row);
    }

    function primaryCell(title, subtitle) {
        return element("span", { className: "cell-primary" }, [
            element("strong", { text: plainValue(title) }),
            subtitle ? element("small", { text: plainValue(subtitle) }) : null
        ]);
    }

    function actionButton(label, handler, variant, disabled, title) {
        return element("button", {
            className: `button button--small ${variant || "button--secondary"}`,
            text: label,
            type: "button",
            disabled: Boolean(disabled),
            title: title || "",
            on: { click: handler }
        });
    }

    function showLogin(message) {
        dom.adminApp.hidden = true;
        dom.loginView.hidden = false;
        closeSidebar();
        if (message) showInlineError(dom.loginError, message);
        else clearInlineError(dom.loginError);
        window.setTimeout(() => dom.loginEmail.focus(), 0);
    }

    function forceLogin(message) {
        state.user = null;
        state.renderEpoch += 1;
        showLogin(message);
    }

    function showApp(user) {
        state.user = user;
        dom.loginView.hidden = true;
        dom.adminApp.hidden = false;
        dom.loginForm.reset();
        clearInlineError(dom.loginError);

        const name = plainValue(ownValue(user, ["name", "fullName", "username"], "Administrator"), "Administrator");
        const email = plainValue(user.email, "");
        dom.adminName.textContent = name;
        dom.adminEmail.textContent = email;
        dom.adminAvatar.textContent = name.trim().charAt(0).toUpperCase() || "A";

        if (user.forcePasswordChange) {
            replaceContent(emptyState("Ganti kata sandi sementara", "Untuk keamanan, buat kata sandi pribadi sebelum menggunakan panel admin."));
            window.setTimeout(openOwnPasswordChange, 0);
            return;
        }

        const hashSection = window.location.hash.replace(/^#/, "");
        navigate(Object.prototype.hasOwnProperty.call(SECTION_META, hashSection) ? hashSection : "dashboard", true);
    }

    function openSidebar() {
        state.sidebarOpen = true;
        dom.sidebar.classList.add("is-open");
        dom.sidebarBackdrop.hidden = false;
        dom.menuButton.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
    }

    function closeSidebar() {
        state.sidebarOpen = false;
        if (dom.sidebar) dom.sidebar.classList.remove("is-open");
        if (dom.sidebarBackdrop) dom.sidebarBackdrop.hidden = true;
        if (dom.menuButton) dom.menuButton.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
    }

    function navigate(section, replaceHash) {
        if (!Object.prototype.hasOwnProperty.call(SECTION_META, section)) section = "dashboard";
        state.section = section;
        const [title, subtitle] = SECTION_META[section];
        dom.pageTitle.textContent = title;
        dom.pageSubtitle.textContent = subtitle;
        document.title = `${title} · Admin CekPinjol.id`;

        document.querySelectorAll("[data-section]").forEach((button) => {
            const active = button.dataset.section === section;
            button.classList.toggle("is-active", active);
            if (active) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
        });

        const hash = `#${section}`;
        if (window.location.hash !== hash) {
            if (replaceHash) history.replaceState(null, "", hash);
            else history.pushState(null, "", hash);
        }
        closeSidebar();
        loadCurrentSection();
    }

    async function loadCurrentSection() {
        const epoch = ++state.renderEpoch;
        replaceContent(loadingState(`Memuat ${SECTION_META[state.section][0].toLowerCase()}…`));
        try {
            switch (state.section) {
                case "dashboard": await loadDashboard(epoch); break;
                case "companies": await loadCompanies(epoch); break;
                case "users": await loadUsers(epoch); break;
                case "reviews": await loadReviews(epoch); break;
                case "reports": await loadReports(epoch); break;
                case "settings": await loadSettings(epoch); break;
                case "audit": await loadAudit(epoch); break;
                default: await loadDashboard(epoch);
            }
        } catch (error) {
            if (epoch !== state.renderEpoch || error.name === "AbortError") return;
            renderError(error, loadCurrentSection);
        }
    }

    function settleConfirm(result) {
        if (typeof state.confirmResolver !== "function") return;
        const resolver = state.confirmResolver;
        state.confirmResolver = null;
        if (dom.confirmDialog.open) dom.confirmDialog.close();
        resolver(Boolean(result));
    }

    function confirmAction(title, message, actionLabel) {
        if (state.confirmResolver) settleConfirm(false);
        dom.confirmTitle.textContent = plainValue(title, "Konfirmasi tindakan");
        dom.confirmMessage.textContent = plainValue(message, "Apakah Anda yakin?");
        dom.confirmSubmit.textContent = plainValue(actionLabel, "Lanjutkan");
        if (!dom.confirmDialog.open) dom.confirmDialog.showModal();
        return new Promise((resolve) => {
            state.confirmResolver = resolve;
        });
    }

    function closeEditor() {
        state.editorSubmit = null;
        if (dom.editorDialog.open) dom.editorDialog.close();
        dom.editorFields.replaceChildren();
        clearInlineError(dom.editorError);
    }

    function appendCurrentOption(select, value) {
        if (value === undefined || value === null || value === "") return;
        const stringValue = String(value);
        const exists = Array.from(select.options).some((option) => option.value === stringValue);
        if (!exists) select.append(element("option", { value: stringValue, text: `Saat ini: ${stringValue}` }));
    }

    function buildEditorField(definition, initialValue) {
        const definitionType = definition.type || "text";
        const inputId = `editor-${definition.name}`;

        if (definitionType === "checkbox") {
            const input = element("input", {
                id: inputId,
                name: definition.name,
                type: "checkbox",
                checked: Boolean(initialValue)
            });
            const copy = element("span", {}, [
                element("strong", { text: definition.label }),
                definition.help ? element("small", { text: definition.help }) : null
            ]);
            return element("label", { className: "field field--checkbox" }, [input, copy]);
        }

        const field = element("label", { className: `field${definition.full ? " field--full" : ""}` });
        field.append(element("span", { text: `${definition.label}${definition.required ? " *" : ""}` }));
        let input;

        if (definitionType === "textarea") {
            input = element("textarea", { id: inputId, name: definition.name });
        } else if (definitionType === "select") {
            input = element("select", { id: inputId, name: definition.name });
            (definition.options || []).forEach((option) => {
                const value = typeof option === "object" ? option.value : option;
                const label = typeof option === "object" ? option.label : option;
                input.append(element("option", { value, text: label }));
            });
            appendCurrentOption(input, initialValue);
        } else {
            input = element("input", { id: inputId, name: definition.name, type: definitionType });
        }

        input.required = Boolean(definition.required);
        if (definition.placeholder) input.placeholder = definition.placeholder;
        if (definition.autocomplete) input.autocomplete = definition.autocomplete;
        if (definition.min !== undefined) input.min = String(definition.min);
        if (definition.max !== undefined) input.max = String(definition.max);
        if (definition.step !== undefined) input.step = String(definition.step);
        if (definition.minLength !== undefined) input.minLength = Number(definition.minLength);
        if (definition.maxLength !== undefined) input.maxLength = Number(definition.maxLength);
        if (definition.inputmode) input.inputMode = definition.inputmode;
        if (initialValue !== undefined && initialValue !== null) input.value = String(initialValue);

        if (definitionType === "password") {
            const control = element("span", { className: "password-control" });
            const toggle = element("button", {
                className: "password-toggle",
                text: "Lihat",
                type: "button",
                attrs: { "aria-label": "Tampilkan kata sandi" },
                on: {
                    click: () => {
                        const visible = input.type === "text";
                        input.type = visible ? "password" : "text";
                        toggle.textContent = visible ? "Lihat" : "Sembunyi";
                        toggle.setAttribute("aria-label", visible ? "Tampilkan kata sandi" : "Sembunyikan kata sandi");
                    }
                }
            });
            control.append(input, toggle);
            field.append(control);
        } else {
            field.append(input);
        }

        if (definition.help) field.append(element("small", { text: definition.help }));
        return field;
    }

    function collectEditorValues(fields) {
        const values = {};
        fields.forEach((definition) => {
            const input = dom.editorForm.elements.namedItem(definition.name);
            if (!input) return;
            values[definition.name] = definition.type === "checkbox" ? input.checked : input.value.trim();
        });
        return values;
    }

    function openEditor(config) {
        const fields = config.fields || [];
        dom.editorTitle.textContent = config.title || "Edit data";
        dom.editorEyebrow.textContent = config.eyebrow || "Form admin";
        dom.editorSubmit.querySelector(".button__label").textContent = config.submitLabel || "Simpan";
        clearInlineError(dom.editorError);
        dom.editorFields.replaceChildren();

        fields.forEach((definition) => {
            let value = config.values ? config.values[definition.name] : "";
            if (definition.type === "datetime-local") value = formatDateTimeLocal(value);
            dom.editorFields.append(buildEditorField(definition, value));
        });

        state.editorSubmit = async () => {
            if (!dom.editorForm.reportValidity()) return;
            const values = collectEditorValues(fields);
            if (typeof config.validate === "function") {
                const validationMessage = config.validate(values);
                if (validationMessage) {
                    showInlineError(dom.editorError, validationMessage);
                    return;
                }
            }

            clearInlineError(dom.editorError);
            setButtonBusy(dom.editorSubmit, true, config.submitLabel || "Simpan");
            try {
                await config.onSubmit(values);
                closeEditor();
            } catch (error) {
                showInlineError(dom.editorError, error instanceof Error ? error.message : "Perubahan gagal disimpan.");
            } finally {
                setButtonBusy(dom.editorSubmit, false, config.submitLabel || "Simpan");
            }
        };

        if (!dom.editorDialog.open) dom.editorDialog.showModal();
        window.setTimeout(() => {
            const first = dom.editorFields.querySelector("input:not([type='hidden']), select, textarea");
            if (first) first.focus();
        }, 0);
    }

    function passwordValidation(password, confirmation) {
        if (password.length < 12) return "Kata sandi harus terdiri dari minimal 12 karakter.";
        if (password.length > 128) return "Kata sandi maksimal 128 karakter.";
        if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
            return "Gunakan kombinasi huruf besar, huruf kecil, angka, dan simbol.";
        }
        if (confirmation !== undefined && password !== confirmation) return "Konfirmasi kata sandi tidak cocok.";
        return "";
    }

    function bindEvents() {
        dom.loginForm.addEventListener("submit", handleLogin);
        dom.changePasswordButton.addEventListener("click", openOwnPasswordChange);
        dom.logoutButton.addEventListener("click", handleLogout);
        dom.refreshButton.addEventListener("click", loadCurrentSection);
        dom.menuButton.addEventListener("click", () => state.sidebarOpen ? closeSidebar() : openSidebar());
        dom.sidebarBackdrop.addEventListener("click", closeSidebar);
        document.querySelectorAll("[data-section]").forEach((button) => {
            button.addEventListener("click", () => navigate(button.dataset.section));
        });
        document.querySelectorAll("[data-password-toggle]").forEach((button) => {
            button.addEventListener("click", () => {
                const input = document.getElementById(button.dataset.passwordToggle);
                if (!input) return;
                const visible = input.type === "text";
                input.type = visible ? "password" : "text";
                button.textContent = visible ? "Lihat" : "Sembunyi";
                button.setAttribute("aria-label", visible ? "Tampilkan kata sandi" : "Sembunyikan kata sandi");
            });
        });

        dom.editorForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (state.editorSubmit) state.editorSubmit();
        });
        dom.editorCancel.addEventListener("click", closeEditor);
        dom.editorClose.addEventListener("click", closeEditor);
        dom.editorDialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            closeEditor();
        });

        dom.confirmForm.addEventListener("submit", (event) => {
            event.preventDefault();
            settleConfirm(true);
        });
        dom.confirmCancel.addEventListener("click", () => settleConfirm(false));
        dom.confirmClose.addEventListener("click", () => settleConfirm(false));
        dom.confirmDialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            settleConfirm(false);
        });

        window.addEventListener("popstate", () => {
            if (!state.user) return;
            const section = window.location.hash.replace(/^#/, "");
            navigate(Object.prototype.hasOwnProperty.call(SECTION_META, section) ? section : "dashboard", true);
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 800 && state.sidebarOpen) closeSidebar();
        });
    }

    async function handleLogin(event) {
        event.preventDefault();
        clearInlineError(dom.loginError);
        if (!dom.loginForm.reportValidity()) return;

        setButtonBusy(dom.loginSubmit, true, "Memeriksa…");
        try {
            const loginPayload = await apiRequest(`${AUTH_API}/login`, {
                method: "POST",
                body: { email: dom.loginEmail.value.trim(), password: dom.loginPassword.value },
                redirectOnUnauthorized: false
            });
            captureCsrf(loginPayload);
            const mePayload = await apiRequest(`${AUTH_API}/me`, { redirectOnUnauthorized: false });
            const user = getUser(mePayload) || getUser(loginPayload);
            if (!user || !isAdmin(user)) {
                try {
                    await apiRequest(`${AUTH_API}/logout`, { method: "POST", redirectOnUnauthorized: false });
                } catch (_error) {
                    // Tetap menolak akses lokal meskipun endpoint logout tidak tersedia.
                }
                throw new Error("Akun ini tidak memiliki izin administrator.");
            }
            showApp(user);
            toast("Login berhasil.", "success");
        } catch (error) {
            dom.loginPassword.value = "";
            showInlineError(dom.loginError, error instanceof Error ? error.message : "Login gagal. Periksa kembali kredensial Anda.");
            dom.loginPassword.focus();
        } finally {
            setButtonBusy(dom.loginSubmit, false, "Masuk");
        }
    }

    function openOwnPasswordChange() {
        openEditor({
            title: "Ganti kata sandi admin",
            eyebrow: "Keamanan akun",
            submitLabel: "Ganti kata sandi",
            fields: [
                { name: "currentPassword", label: "Kata sandi saat ini", type: "password", required: true, maxLength: 128, autocomplete: "current-password", full: true },
                { name: "newPassword", label: "Kata sandi baru", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true, help: "Minimal 12 karakter. Setelah disimpan, semua sesi akun akan dicabut." },
                { name: "passwordConfirmation", label: "Konfirmasi kata sandi baru", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true }
            ],
            validate: (values) => {
                if (!values.currentPassword) return "Kata sandi saat ini wajib diisi.";
                return passwordValidation(values.newPassword, values.passwordConfirmation);
            },
            onSubmit: async (values) => {
                await apiRequest(`${AUTH_API}/change-password`, {
                    method: "POST",
                    body: { currentPassword: values.currentPassword, newPassword: values.newPassword }
                });
                closeEditor();
                state.csrfToken = "";
                forceLogin("Kata sandi berhasil diubah. Silakan masuk kembali.");
            }
        });
    }

    async function handleLogout() {
        const confirmed = await confirmAction("Keluar dari panel admin?", "Sesi admin pada perangkat ini akan diakhiri.", "Keluar");
        if (!confirmed) return;
        dom.logoutButton.disabled = true;
        try {
            await apiRequest(`${AUTH_API}/logout`, { method: "POST", redirectOnUnauthorized: false });
            state.csrfToken = "";
            forceLogin("Anda telah keluar dengan aman.");
        } catch (error) {
            toast(error instanceof Error ? error.message : "Tidak dapat mengakhiri sesi.", "error");
        } finally {
            dom.logoutButton.disabled = false;
        }
    }

    async function restoreSession() {
        try {
            const payload = await apiRequest(`${AUTH_API}/me`, { redirectOnUnauthorized: false });
            const user = getUser(payload);
            if (!user) {
                showLogin();
                return;
            }
            if (!isAdmin(user)) {
                showLogin("Akun yang sedang aktif tidak memiliki izin administrator.");
                return;
            }
            showApp(user);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) showLogin();
            else showLogin(error instanceof Error ? error.message : "Tidak dapat memeriksa sesi admin.");
        }
    }

    async function init() {
        cacheDom();
        bindEvents();
        await restoreSession();
    }

    document.addEventListener("DOMContentLoaded", init, { once: true });

    async function loadDashboard(epoch) {
        const payload = await apiRequest(`${ADMIN_API}/dashboard`);
        if (epoch !== state.renderEpoch) return;
        const data = objectFromPayload(payload);
        const counts = data.counts && typeof data.counts === "object" ? data.counts : data;

        const cards = [
            ["Total akun", ownValue(counts, ["users", "totalUsers", "userCount"], 0), "Semua akun terdaftar"],
            ["Data pinjol", ownValue(counts, ["companies", "totalCompanies", "companyCount"], 0), `${formatNumber(ownValue(counts, ["publishedCompanies", "published"], 0))} dipublikasikan`],
            ["Ulasan tertunda", ownValue(counts, ["pendingReviews", "reviewsPending"], 0), "Perlu dimoderasi"],
            ["Laporan baru", ownValue(counts, ["newReports", "openReports", "pendingReports"], 0), "Perlu ditinjau"]
        ];
        const stats = element("div", { className: "stats-grid" });
        cards.forEach(([label, value, meta]) => {
            stats.append(element("article", { className: "stat-card" }, [
                element("span", { className: "stat-card__label", text: label }),
                element("strong", { className: "stat-card__value", text: formatNumber(value) }),
                element("span", { className: "stat-card__meta", text: meta })
            ]));
        });

        const recentReviews = Array.isArray(data.recentReviews) ? data.recentReviews : [];
        const reviewsPanel = makePanel("Ulasan terbaru", "Status ulasan yang baru dikirim");
        const reviewsTable = makeTable(["Pengguna", "Pinjol", "Rating", "Status", "Waktu"]);
        if (!recentReviews.length) emptyTableRow(reviewsTable.tbody, 5, "Belum ada ulasan terbaru.");
        recentReviews.forEach((review) => {
            const row = element("tr");
            row.append(
                tableCell(nestedName(ownValue(review, ["user", "displayName", "userName"], null), "Anonim")),
                tableCell(nestedName(ownValue(review, ["companyName", "company"], null), "—")),
                tableCell(element("span", { className: "rating", text: `★ ${plainValue(review.rating, "—")}` })),
                tableCell(badge(review.status)),
                tableCell(formatDate(review.createdAt))
            );
            reviewsTable.tbody.append(row);
        });
        reviewsPanel.append(reviewsTable.wrap);

        const recentReports = Array.isArray(data.recentReports) ? data.recentReports : [];
        const reportPanel = makePanel("Laporan terbaru", "Laporan pengguna yang baru masuk");
        const reportBody = element("div", { className: "panel__body" });
        const list = element("ul", { className: "summary-list" });
        if (!recentReports.length) {
            list.append(element("li", {}, [element("span", { text: "Belum ada laporan terbaru." })]));
        } else {
            recentReports.forEach((report) => {
                list.append(element("li", {}, [
                    element("span", { className: "truncate", text: plainValue(report.companyName, "Laporan tanpa nama pinjol") }),
                    badge(report.status)
                ]));
            });
        }
        reportBody.append(list);
        reportPanel.append(reportBody);

        const overviewPanel = makePanel("Ringkasan pengelolaan", "Kondisi data saat ini");
        const overviewBody = element("div", { className: "panel__body" });
        const overview = element("ul", { className: "summary-list" }, [
            element("li", {}, [element("span", { text: "Akun diblokir" }), element("strong", { text: formatNumber(ownValue(counts, ["blockedUsers"], 0)) })]),
            element("li", {}, [element("span", { text: "Pinjol dipublikasikan" }), element("strong", { text: formatNumber(ownValue(counts, ["publishedCompanies"], 0)) })]),
            element("li", {}, [element("span", { text: "Ulasan menunggu" }), element("strong", { text: formatNumber(ownValue(counts, ["pendingReviews"], 0)) })]),
            element("li", {}, [element("span", { text: "Laporan baru" }), element("strong", { text: formatNumber(ownValue(counts, ["newReports"], 0)) })])
        ]);
        overviewBody.append(overview);
        overviewPanel.append(overviewBody);

        const dashboardGrid = element("div", { className: "dashboard-grid" }, [reviewsPanel, overviewPanel]);
        const stack = element("div", { className: "section-stack" }, [stats, dashboardGrid, reportPanel]);
        replaceContent(stack);
    }

    const COMPANY_FIELDS = Object.freeze([
        { name: "name", label: "Nama pinjol", required: true, minLength: 2, maxLength: 150, full: true },
        { name: "status", label: "Status legalitas", type: "select", required: true, options: [{ value: "Legal", label: "Legal" }, { value: "Ilegal", label: "Ilegal" }] },
        { name: "publicationStatus", label: "Status publikasi", type: "select", required: true, options: [{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }] },
        { name: "imageUrl", label: "URL gambar", type: "url", maxLength: 2048, full: true, placeholder: "https://…" },
        { name: "ojkNumber", label: "Nomor izin OJK", maxLength: 200, help: "Wajib bila status Legal." },
        { name: "trustLevel", label: "Tingkat kepercayaan", type: "number", min: 0, max: 100, step: 1, required: true },
        { name: "limit", label: "Limit pinjaman", maxLength: 300 },
        { name: "tenor", label: "Tenor", maxLength: 300 },
        { name: "interest", label: "Bunga", maxLength: 300 },
        { name: "adminFee", label: "Biaya admin", maxLength: 300 },
        { name: "address", label: "Alamat", type: "textarea", maxLength: 1000, full: true },
        { name: "description", label: "Deskripsi", type: "textarea", required: true, minLength: 10, maxLength: 5000, full: true },
        { name: "sourceUrl", label: "URL sumber", type: "url", maxLength: 2048, full: true, placeholder: "https://ojk.go.id/…", help: "Wajib saat data dipublikasikan." },
        { name: "sourceCheckedAt", label: "Sumber diperiksa pada", type: "datetime-local", help: "Wajib saat data dipublikasikan." },
        { name: "featured", label: "Tampilkan sebagai unggulan", type: "checkbox", help: "Data dapat ditonjolkan di halaman pengguna." }
    ]);

    function companyPayload(values, version) {
        const nullable = (value) => value === "" ? null : value;
        const checkedAt = values.sourceCheckedAt ? new Date(values.sourceCheckedAt).toISOString() : null;
        const payload = {
            name: values.name,
            status: values.status,
            publicationStatus: values.publicationStatus,
            imageUrl: nullable(values.imageUrl),
            ojkNumber: nullable(values.ojkNumber),
            trustLevel: Number(values.trustLevel),
            limit: nullable(values.limit),
            tenor: nullable(values.tenor),
            interest: nullable(values.interest),
            adminFee: nullable(values.adminFee),
            address: nullable(values.address),
            description: values.description,
            sourceUrl: nullable(values.sourceUrl),
            sourceCheckedAt: checkedAt,
            featured: Boolean(values.featured)
        };
        if (version !== undefined && version !== null) payload.version = version;
        return payload;
    }

    function validateCompany(values) {
        if (values.status === "Legal" && !values.ojkNumber) return "Nomor izin OJK wajib diisi untuk pinjol Legal.";
        if (values.publicationStatus === "published" && (!values.sourceUrl || !values.sourceCheckedAt)) {
            return "URL sumber dan tanggal pemeriksaan wajib diisi sebelum data dipublikasikan.";
        }
        if (!Number.isFinite(Number(values.trustLevel)) || Number(values.trustLevel) < 0 || Number(values.trustLevel) > 100) {
            return "Tingkat kepercayaan harus berupa angka 0 sampai 100.";
        }
        return "";
    }

    async function openCompanyEditor(company) {
        const editing = Boolean(company);
        openEditor({
            title: editing ? "Edit data pinjol" : "Tambah data pinjol",
            eyebrow: "Data publik",
            submitLabel: editing ? "Simpan perubahan" : "Tambah pinjol",
            fields: COMPANY_FIELDS,
            values: company || { status: "Legal", publicationStatus: "draft", trustLevel: 50, featured: false },
            validate: validateCompany,
            onSubmit: async (values) => {
                const id = editing ? entityId(company) : "";
                await apiRequest(editing ? `${ADMIN_API}/companies/${encodeURIComponent(id)}` : `${ADMIN_API}/companies`, {
                    method: editing ? "PATCH" : "POST",
                    body: companyPayload(values, editing ? company.version : undefined)
                });
                toast(editing ? "Data pinjol diperbarui." : "Data pinjol ditambahkan.", "success");
                await loadCurrentSection();
            }
        });
    }

    async function deleteCompany(company) {
        const confirmed = await confirmAction(
            "Hapus data pinjol?",
            `Data “${plainValue(company.name, "tanpa nama")}” akan diarsipkan dan tidak lagi tampil kepada pengguna.`,
            "Hapus data"
        );
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/companies/${encodeURIComponent(entityId(company))}`, { method: "DELETE" });
            toast("Data pinjol dihapus.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Data pinjol gagal dihapus.", "error");
        }
    }

    async function loadCompanies(epoch) {
        const payload = await apiRequest(`${ADMIN_API}/companies?limit=100`);
        if (epoch !== state.renderEpoch) return;
        renderCompanies(listFromPayload(payload, ["companies"]));
    }

    function renderCompanies(companies) {
        const addButton = element("button", {
            className: "button button--primary",
            text: "+ Tambah pinjol",
            type: "button",
            on: { click: () => openCompanyEditor(null) }
        });
        const panel = makePanel("Daftar pinjol", `${companies.length} data dimuat`, addButton);

        const search = element("input", {
            className: "search-input",
            type: "search",
            value: state.companies.search,
            placeholder: "Cari nama atau deskripsi…",
            attrs: { "aria-label": "Cari data pinjol" }
        });
        const statusFilter = element("select", { attrs: { "aria-label": "Filter legalitas" } }, [
            element("option", { value: "", text: "Semua legalitas" }),
            element("option", { value: "Legal", text: "Legal" }),
            element("option", { value: "Ilegal", text: "Ilegal" })
        ]);
        statusFilter.value = state.companies.status;
        const publicationFilter = element("select", { attrs: { "aria-label": "Filter publikasi" } }, [
            element("option", { value: "", text: "Semua publikasi" }),
            element("option", { value: "draft", text: "Draft" }),
            element("option", { value: "published", text: "Published" }),
            element("option", { value: "archived", text: "Archived" })
        ]);
        publicationFilter.value = state.companies.publicationStatus;
        const toolbar = element("div", { className: "toolbar toolbar--panel" }, [
            element("span", { className: "search-wrap" }, search), statusFilter, publicationFilter
        ]);

        const table = makeTable(["Pinjol", "Legalitas", "Publikasi", "Kepercayaan", "Unggulan", "Diperbarui", "Aksi"]);
        const footer = element("footer", { className: "panel__footer" });

        const drawRows = () => {
            const query = state.companies.search.trim().toLowerCase();
            const filtered = companies.filter((company) => {
                const haystack = `${plainValue(company.name, "")} ${plainValue(company.description, "")}`.toLowerCase();
                return (!query || haystack.includes(query))
                    && (!state.companies.status || company.status === state.companies.status)
                    && (!state.companies.publicationStatus || company.publicationStatus === state.companies.publicationStatus);
            });
            table.tbody.replaceChildren();
            if (!filtered.length) emptyTableRow(table.tbody, 7, "Tidak ada data pinjol yang cocok.");
            filtered.forEach((company) => {
                const id = entityId(company);
                const sourceUrl = safeHttpUrl(company.sourceUrl);
                const subtitle = company.ojkNumber || (sourceUrl ? "Memiliki sumber" : "Belum ada nomor OJK");
                const row = element("tr");
                row.append(
                    tableCell(primaryCell(company.name, subtitle)),
                    tableCell(badge(company.status)),
                    tableCell(badge(company.publicationStatus)),
                    tableCell(`${plainValue(company.trustLevel, 0)}/100`),
                    tableCell(company.featured ? badge("featured", "info") : "—"),
                    tableCell(formatDate(company.updatedAt || company.createdAt)),
                    tableCell(element("span", { className: "actions" }, [
                        actionButton("Edit", () => openCompanyEditor(company)),
                        actionButton("Hapus", () => deleteCompany(company), "button--soft-danger", !id)
                    ]))
                );
                table.tbody.append(row);
            });
            footer.textContent = `Menampilkan ${filtered.length} dari ${companies.length} data.`;
        };

        search.addEventListener("input", () => { state.companies.search = search.value; drawRows(); });
        statusFilter.addEventListener("change", () => { state.companies.status = statusFilter.value; drawRows(); });
        publicationFilter.addEventListener("change", () => { state.companies.publicationStatus = publicationFilter.value; drawRows(); });
        panel.append(toolbar, table.wrap, footer);
        replaceContent(element("div", { className: "section-stack" }, panel));
        drawRows();
    }

    const USER_BASE_FIELDS = Object.freeze([
        { name: "name", label: "Nama lengkap", required: true, minLength: 2, maxLength: 100 },
        { name: "email", label: "Email", type: "email", required: true, maxLength: 254, autocomplete: "off" },
        { name: "role", label: "Peran", type: "select", required: true, options: [{ value: "user", label: "User" }, { value: "admin", label: "Admin" }] },
        { name: "forcePasswordChange", label: "Wajib ganti kata sandi saat login", type: "checkbox", help: "Direkomendasikan untuk akun yang dibuat oleh admin." }
    ]);

    function currentUserMatches(user) {
        return String(entityId(user)) === String(entityId(state.user));
    }

    function openUserEditor(user) {
        const editing = Boolean(user);
        const fields = [...USER_BASE_FIELDS];
        if (!editing) {
            fields.splice(3, 0,
                { name: "password", label: "Kata sandi sementara", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true, help: "Minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan simbol." },
                { name: "passwordConfirmation", label: "Konfirmasi kata sandi", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true }
            );
        }
        openEditor({
            title: editing ? "Edit akun" : "Tambah akun",
            eyebrow: "Manajemen akun",
            submitLabel: editing ? "Simpan akun" : "Buat akun",
            fields,
            values: user || { role: "user", forcePasswordChange: true },
            validate: (values) => {
                if (!editing) return passwordValidation(values.password, values.passwordConfirmation);
                return "";
            },
            onSubmit: async (values) => {
                const payload = {
                    name: values.name,
                    email: values.email.toLowerCase(),
                    role: values.role,
                    forcePasswordChange: Boolean(values.forcePasswordChange)
                };
                if (!editing) payload.password = values.password;
                await apiRequest(editing
                    ? `${ADMIN_API}/users/${encodeURIComponent(entityId(user))}`
                    : `${ADMIN_API}/users`, {
                    method: editing ? "PATCH" : "POST",
                    body: payload
                });
                toast(editing ? "Akun diperbarui." : "Akun berhasil dibuat.", "success");
                await loadCurrentSection();
            }
        });
    }

    function openPasswordReset(user) {
        openEditor({
            title: "Reset kata sandi",
            eyebrow: "Keamanan akun",
            submitLabel: "Reset kata sandi",
            fields: [
                { name: "password", label: "Kata sandi sementara baru", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true, help: "Minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan simbol. Semua sesi akun akan dicabut." },
                { name: "passwordConfirmation", label: "Konfirmasi kata sandi", type: "password", required: true, minLength: 12, maxLength: 128, autocomplete: "new-password", full: true }
            ],
            validate: (values) => passwordValidation(values.password, values.passwordConfirmation),
            onSubmit: async (values) => {
                await apiRequest(`${ADMIN_API}/users/${encodeURIComponent(entityId(user))}/reset-password`, {
                    method: "POST",
                    body: { password: values.password }
                });
                toast("Kata sandi direset. Pengguna wajib menggantinya saat login.", "success");
                await loadCurrentSection();
            }
        });
    }

    function openBlockUser(user) {
        openEditor({
            title: "Blokir akun",
            eyebrow: "Pembatasan akses",
            submitLabel: "Blokir akun",
            fields: [
                { name: "reason", label: "Alasan pemblokiran", type: "textarea", required: true, minLength: 3, maxLength: 500, full: true, help: "Alasan disimpan di audit log dan informasi akun." }
            ],
            validate: (values) => values.reason.length < 3 ? "Alasan pemblokiran minimal 3 karakter." : "",
            onSubmit: async (values) => {
                await apiRequest(`${ADMIN_API}/users/${encodeURIComponent(entityId(user))}/block`, {
                    method: "POST",
                    body: { reason: values.reason }
                });
                toast("Akun diblokir dan seluruh sesinya dicabut.", "success");
                await loadCurrentSection();
            }
        });
    }

    async function unblockUser(user) {
        const confirmed = await confirmAction("Buka blokir akun?", `Akun ${plainValue(user.email, "ini")} akan dapat masuk kembali.`, "Buka blokir");
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/users/${encodeURIComponent(entityId(user))}/unblock`, { method: "POST" });
            toast("Blokir akun dibuka.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Gagal membuka blokir.", "error");
        }
    }

    async function revokeUserSessions(user) {
        const confirmed = await confirmAction("Cabut semua sesi?", `Semua perangkat akun ${plainValue(user.email, "ini")} akan dikeluarkan.`, "Cabut sesi");
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/users/${encodeURIComponent(entityId(user))}/revoke-sessions`, { method: "POST" });
            toast("Semua sesi aktif akun telah dicabut.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Gagal mencabut sesi.", "error");
        }
    }

    async function deleteUser(user) {
        const confirmed = await confirmAction(
            "Hapus akun?",
            `Akun ${plainValue(user.email, "ini")} akan dinonaktifkan dan seluruh sesinya dicabut. Tindakan ini tercatat di audit log.`,
            "Hapus akun"
        );
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/users/${encodeURIComponent(entityId(user))}`, { method: "DELETE" });
            toast("Akun dihapus.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Akun gagal dihapus.", "error");
        }
    }

    function userQuery() {
        const params = new URLSearchParams({ limit: "100" });
        if (state.users.search) params.set("q", state.users.search);
        if (state.users.role) params.set("role", state.users.role);
        if (state.users.status) params.set("status", state.users.status);
        return params.toString();
    }

    async function loadUsers(epoch) {
        const sequence = ++state.users.sequence;
        const payload = await apiRequest(`${ADMIN_API}/users?${userQuery()}`);
        if (epoch !== state.renderEpoch || sequence !== state.users.sequence) return;
        renderUsers(listFromPayload(payload, ["users"]));
    }

    function queueUserReload() {
        window.clearTimeout(userSearchTimer);
        userSearchTimer = window.setTimeout(() => {
            if (state.section !== "users") return;
            const epoch = ++state.renderEpoch;
            replaceContent(loadingState("Mencari akun…"));
            loadUsers(epoch).catch((error) => {
                if (epoch === state.renderEpoch) renderError(error, loadCurrentSection);
            });
        }, 300);
    }

    function renderUsers(users) {
        const addButton = element("button", {
            className: "button button--primary",
            text: "+ Tambah akun",
            type: "button",
            on: { click: () => openUserEditor(null) }
        });
        const panel = makePanel("Daftar akun", `${users.length} akun dimuat`, addButton);
        const search = element("input", {
            className: "search-input",
            type: "search",
            value: state.users.search,
            placeholder: "Cari nama atau email…",
            attrs: { "aria-label": "Cari akun" }
        });
        const role = element("select", { attrs: { "aria-label": "Filter peran" } }, [
            element("option", { value: "", text: "Semua peran" }),
            element("option", { value: "user", text: "User" }),
            element("option", { value: "admin", text: "Admin" })
        ]);
        role.value = state.users.role;
        const status = element("select", { attrs: { "aria-label": "Filter status akun" } }, [
            element("option", { value: "", text: "Semua status" }),
            element("option", { value: "active", text: "Active" }),
            element("option", { value: "blocked", text: "Blocked" })
        ]);
        status.value = state.users.status;
        search.addEventListener("input", () => { state.users.search = search.value.trim(); queueUserReload(); });
        role.addEventListener("change", () => { state.users.role = role.value; loadCurrentSection(); });
        status.addEventListener("change", () => { state.users.status = status.value; loadCurrentSection(); });
        panel.append(element("div", { className: "toolbar toolbar--panel" }, [element("span", { className: "search-wrap" }, search), role, status]));

        const table = makeTable(["Akun", "Peran", "Status", "Alasan blokir", "Sesi", "Dibuat", "Aksi"]);
        if (!users.length) emptyTableRow(table.tbody, 7, "Tidak ada akun yang cocok.");
        users.forEach((user) => {
            const id = entityId(user);
            const isSelf = currentUserMatches(user);
            const blocked = String(user.status).toLowerCase() === "blocked";
            const actions = element("span", { className: "actions" }, [
                actionButton("Edit", () => openUserEditor(user), "button--secondary", !id),
                blocked
                    ? actionButton("Unblock", () => unblockUser(user), "button--secondary", isSelf || !id, isSelf ? "Akun sendiri tidak dapat diubah." : "")
                    : actionButton("Blokir", () => openBlockUser(user), "button--soft-danger", isSelf || !id, isSelf ? "Akun sendiri tidak dapat diblokir." : ""),
                actionButton("Reset sandi", () => openPasswordReset(user), "button--secondary", isSelf || !id, isSelf ? "Gunakan menu ganti kata sandi untuk akun sendiri." : ""),
                actionButton("Cabut sesi", () => revokeUserSessions(user), "button--secondary", isSelf || !id || Number(user.activeSessions) < 1),
                actionButton("Hapus", () => deleteUser(user), "button--soft-danger", isSelf || !id, isSelf ? "Akun sendiri tidak dapat dihapus." : "")
            ]);
            const row = element("tr");
            row.append(
                tableCell(primaryCell(user.name, user.email)),
                tableCell(badge(user.role)),
                tableCell(badge(user.status)),
                tableCell(element("span", { className: "truncate", text: plainValue(user.blockedReason) })),
                tableCell(formatNumber(user.activeSessions || 0)),
                tableCell(formatDate(user.createdAt)),
                tableCell(actions)
            );
            table.tbody.append(row);
        });
        panel.append(table.wrap, element("footer", { className: "panel__footer", text: "Status blocked mencabut akses dan seluruh sesi aktif. Kata sandi tidak pernah ditampilkan kembali." }));
        replaceContent(element("div", { className: "section-stack" }, panel));
    }

    function reviewUserName(review) {
        return nestedName(ownValue(review, ["displayName", "userName", "user"], null), "Anonim");
    }

    async function moderateReview(review, status, moderationNote) {
        try {
            await apiRequest(`${ADMIN_API}/reviews/${encodeURIComponent(entityId(review))}`, {
                method: "PATCH",
                body: { status, moderationNote: moderationNote || null }
            });
            toast(`Status ulasan diubah menjadi ${status}.`, "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Moderasi ulasan gagal.", "error");
        }
    }

    function openReviewModeration(review, initialStatus) {
        openEditor({
            title: "Moderasi ulasan",
            eyebrow: "Konten pengguna",
            submitLabel: "Simpan moderasi",
            fields: [
                { name: "status", label: "Status", type: "select", required: true, options: [
                    { value: "pending", label: "Pending" },
                    { value: "approved", label: "Approved" },
                    { value: "rejected", label: "Rejected" },
                    { value: "hidden", label: "Hidden" }
                ] },
                { name: "moderationNote", label: "Catatan moderasi", type: "textarea", maxLength: 1000, full: true, help: "Catatan internal untuk keputusan moderasi." }
            ],
            values: { status: initialStatus || review.status, moderationNote: review.moderationNote || "" },
            onSubmit: async (values) => {
                await apiRequest(`${ADMIN_API}/reviews/${encodeURIComponent(entityId(review))}`, {
                    method: "PATCH",
                    body: { status: values.status, moderationNote: values.moderationNote || null }
                });
                toast("Moderasi ulasan disimpan.", "success");
                await loadCurrentSection();
            }
        });
    }

    async function deleteReview(review) {
        const confirmed = await confirmAction(
            "Hapus ulasan?",
            `Ulasan dari ${reviewUserName(review)} akan dihapus dari sistem publik.`,
            "Hapus ulasan"
        );
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/reviews/${encodeURIComponent(entityId(review))}`, { method: "DELETE" });
            toast("Ulasan dihapus.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Ulasan gagal dihapus.", "error");
        }
    }

    async function loadReviews(epoch) {
        const params = new URLSearchParams({ limit: "100" });
        if (state.reviews.status) params.set("status", state.reviews.status);
        const payload = await apiRequest(`${ADMIN_API}/reviews?${params.toString()}`);
        if (epoch !== state.renderEpoch) return;
        renderReviews(listFromPayload(payload, ["reviews"]));
    }

    function renderReviews(reviews) {
        const filter = element("select", { attrs: { "aria-label": "Filter status ulasan" } }, [
            element("option", { value: "", text: "Semua status" }),
            element("option", { value: "pending", text: "Pending" }),
            element("option", { value: "approved", text: "Approved" }),
            element("option", { value: "rejected", text: "Rejected" }),
            element("option", { value: "hidden", text: "Hidden" })
        ]);
        filter.value = state.reviews.status;
        filter.addEventListener("change", () => { state.reviews.status = filter.value; loadCurrentSection(); });
        const panel = makePanel("Moderasi ulasan", `${reviews.length} ulasan dimuat`, filter);
        const table = makeTable(["Pengguna", "Pinjol", "Ulasan", "Rating", "Status", "Waktu", "Aksi"]);
        if (!reviews.length) emptyTableRow(table.tbody, 7, "Tidak ada ulasan pada status ini.");
        reviews.forEach((review) => {
            const id = entityId(review);
            const comment = ownValue(review, ["comment", "content", "text"], "");
            const actions = element("span", { className: "actions" }, [
                actionButton("Setujui", () => moderateReview(review, "approved", review.moderationNote), "button--secondary", !id || review.status === "approved"),
                actionButton("Tolak", () => openReviewModeration(review, "rejected"), "button--secondary", !id || review.status === "rejected"),
                actionButton("Sembunyikan", () => openReviewModeration(review, "hidden"), "button--secondary", !id || review.status === "hidden"),
                actionButton("Detail", () => openReviewModeration(review), "button--secondary", !id),
                actionButton("Hapus", () => deleteReview(review), "button--soft-danger", !id)
            ]);
            const row = element("tr");
            row.append(
                tableCell(primaryCell(reviewUserName(review), review.userId ? `ID: ${review.userId}` : "Pengguna tamu")),
                tableCell(plainValue(review.companyName)),
                tableCell(element("span", { className: "truncate", text: plainValue(comment) })),
                tableCell(element("span", { className: "rating", text: `★ ${plainValue(review.rating)}` })),
                tableCell(badge(review.status)),
                tableCell(formatDate(review.createdAt)),
                tableCell(actions)
            );
            table.tbody.append(row);
        });
        panel.append(table.wrap, element("footer", { className: "panel__footer", text: "Approved tampil kepada pengguna; rejected dan hidden tidak ditampilkan di halaman publik." }));
        replaceContent(element("div", { className: "section-stack" }, panel));
    }

    function openReportEditor(report) {
        openEditor({
            title: "Tindak lanjuti laporan",
            eyebrow: "Penanganan laporan",
            submitLabel: "Simpan tindak lanjut",
            fields: [
                { name: "status", label: "Status", type: "select", required: true, options: [
                    { value: "new", label: "Baru" },
                    { value: "in_review", label: "Sedang ditinjau" },
                    { value: "resolved", label: "Selesai" },
                    { value: "rejected", label: "Ditolak" },
                    { value: "archived", label: "Diarsipkan" }
                ] },
                { name: "adminNote", label: "Catatan admin", type: "textarea", maxLength: 5000, full: true, help: "Catatan internal mengenai pemeriksaan dan keputusan." }
            ],
            values: { status: report.status || "new", adminNote: report.adminNote || "" },
            onSubmit: async (values) => {
                await apiRequest(`${ADMIN_API}/reports/${encodeURIComponent(entityId(report))}`, {
                    method: "PATCH",
                    body: { status: values.status, adminNote: values.adminNote || null }
                });
                toast("Tindak lanjut laporan disimpan.", "success");
                await loadCurrentSection();
            }
        });
    }

    async function deleteReport(report) {
        const confirmed = await confirmAction(
            "Hapus laporan?",
            `Laporan mengenai ${plainValue(report.companyName, "pinjol ini")} akan diarsipkan dan dihapus dari antrean aktif.`,
            "Hapus laporan"
        );
        if (!confirmed) return;
        try {
            await apiRequest(`${ADMIN_API}/reports/${encodeURIComponent(entityId(report))}`, { method: "DELETE" });
            toast("Laporan dihapus dari antrean aktif.", "success");
            await loadCurrentSection();
        } catch (error) {
            toast(error instanceof Error ? error.message : "Laporan gagal dihapus.", "error");
        }
    }

    async function loadReports(epoch) {
        const params = new URLSearchParams({ limit: "100" });
        if (state.reports.status) params.set("status", state.reports.status);
        const payload = await apiRequest(`${ADMIN_API}/reports?${params.toString()}`);
        if (epoch !== state.renderEpoch) return;
        renderReports(listFromPayload(payload, ["reports"]));
    }

    function renderReports(reports) {
        const filter = element("select", { attrs: { "aria-label": "Filter status laporan" } }, [
            element("option", { value: "", text: "Semua status" }),
            element("option", { value: "new", text: "Baru" }),
            element("option", { value: "in_review", text: "Sedang ditinjau" }),
            element("option", { value: "resolved", text: "Selesai" }),
            element("option", { value: "rejected", text: "Ditolak" }),
            element("option", { value: "archived", text: "Diarsipkan" })
        ]);
        filter.value = state.reports.status;
        filter.addEventListener("change", () => { state.reports.status = filter.value; loadCurrentSection(); });
        const panel = makePanel("Laporan pengguna", `${reports.length} laporan dimuat`, filter);
        const table = makeTable(["Pelapor", "Pinjol", "Keterangan", "Bukti", "Status", "Catatan admin", "Waktu", "Aksi"]);
        if (!reports.length) emptyTableRow(table.tbody, 8, "Tidak ada laporan pada status ini.");
        reports.forEach((report) => {
            const id = entityId(report);
            const evidenceUrl = safeHttpUrl(report.evidenceUrl);
            const evidence = evidenceUrl
                ? element("a", { className: "inline-link", text: "Buka bukti", href: evidenceUrl, target: "_blank", rel: "noopener noreferrer" })
                : "—";
            const row = element("tr");
            row.append(
                tableCell(primaryCell(report.reporterName, report.reporterEmail)),
                tableCell(plainValue(report.companyName)),
                tableCell(element("span", { className: "truncate", text: plainValue(report.description) })),
                tableCell(evidence),
                tableCell(badge(report.status)),
                tableCell(element("span", { className: "truncate", text: plainValue(report.adminNote) })),
                tableCell(formatDate(report.createdAt)),
                tableCell(element("span", { className: "actions" }, [
                    actionButton("Tangani", () => openReportEditor(report), "button--secondary", !id),
                    actionButton("Hapus", () => deleteReport(report), "button--soft-danger", !id)
                ]))
            );
            table.tbody.append(row);
        });
        panel.append(table.wrap, element("footer", { className: "panel__footer", text: "Catatan admin bersifat internal. Tindakan selesai, ditolak, atau diarsipkan menyimpan waktu penanganan." }));
        replaceContent(element("div", { className: "section-stack" }, panel));
    }

    const SETTING_FIELDS = Object.freeze([
        { key: "siteName", label: "Nama situs", type: "text", maxLength: 200, help: "Nama yang digunakan pada identitas utama situs." },
        { key: "heroTitle", label: "Judul hero", type: "text", maxLength: 500, help: "Judul utama pada halaman beranda." },
        { key: "heroSubtitle", label: "Subjudul hero", type: "textarea", maxLength: 2000, help: "Teks pendukung di bawah judul utama." },
        { key: "announcement", label: "Pengumuman data", type: "textarea", maxLength: 2000, help: "Catatan penting yang tampil di bagian atas seluruh halaman pengguna." },
        { key: "aboutDescription", label: "Deskripsi tentang", type: "textarea", maxLength: 5000, help: "Penjelasan singkat mengenai layanan." },
        { key: "footerText", label: "Teks footer", type: "textarea", maxLength: 2000, help: "Teks yang ditampilkan pada bagian bawah halaman." },
        { key: "disclaimer", label: "Disclaimer", type: "textarea", maxLength: 3000, help: "Pernyataan batas penggunaan informasi dan anjuran verifikasi resmi." }
    ]);

    async function loadSettings(epoch) {
        const payload = await apiRequest(`${ADMIN_API}/settings`);
        if (epoch !== state.renderEpoch) return;
        renderSettings(objectFromPayload(payload, ["settings"]));
    }

    function renderSettings(settings) {
        const panel = makePanel("Konten halaman pengguna", "Hanya kunci pengaturan yang diizinkan yang dapat diubah");
        const body = element("div", { className: "panel__body" });
        const form = element("form", { className: "settings-form", attrs: { novalidate: "" } });

        SETTING_FIELDS.forEach((definition, index) => {
            const field = element("label", { className: `field${definition.type === "textarea" ? " field--full" : ""}` });
            field.append(element("span", { text: definition.label }));
            const input = definition.type === "textarea"
                ? element("textarea", { name: definition.key, id: `setting-${definition.key}` })
                : element("input", { name: definition.key, id: `setting-${definition.key}`, type: "text" });
            input.maxLength = definition.maxLength;
            input.value = typeof settings[definition.key] === "string" ? settings[definition.key] : "";
            if (index < 2) input.required = true;
            field.append(input, element("small", { text: definition.help }));
            form.append(field);
        });

        const saveButton = element("button", { className: "button button--primary", type: "submit" }, [
            element("span", { className: "button__label", text: "Simpan pengaturan" }),
            element("span", { className: "spinner", hidden: true, attrs: { "aria-hidden": "true" } })
        ]);
        form.append(element("div", { className: "settings-form__footer" }, saveButton));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const updates = {};
            SETTING_FIELDS.forEach((definition) => {
                const input = form.elements.namedItem(definition.key);
                updates[definition.key] = input ? input.value.trim() : "";
            });
            setButtonBusy(saveButton, true, "Menyimpan…");
            try {
                await apiRequest(`${ADMIN_API}/settings`, { method: "PATCH", body: updates });
                toast("Pengaturan halaman pengguna disimpan.", "success");
                await loadCurrentSection();
            } catch (error) {
                toast(error instanceof Error ? error.message : "Pengaturan gagal disimpan.", "error");
            } finally {
                setButtonBusy(saveButton, false, "Simpan pengaturan");
            }
        });
        body.append(form);
        panel.append(body, element("footer", { className: "panel__footer", text: "Perubahan pengaturan ini akan dibaca oleh halaman pengguna melalui API publik." }));
        replaceContent(element("div", { className: "section-stack" }, panel));
    }

    function jsonSummary(value) {
        if (value === null || value === undefined) return "—";
        try {
            const serialized = typeof value === "string" ? value : JSON.stringify(value);
            return serialized.length > 220 ? `${serialized.slice(0, 217)}…` : serialized;
        } catch (_error) {
            return "[data tidak dapat ditampilkan]";
        }
    }

    async function loadAudit(epoch) {
        const payload = await apiRequest(`${ADMIN_API}/audit-logs?limit=100`);
        if (epoch !== state.renderEpoch) return;
        renderAudit(listFromPayload(payload, ["auditLogs", "logs"]));
    }

    function renderAudit(logs) {
        const panel = makePanel("Riwayat audit", `${logs.length} catatan terbaru · hanya-baca`, badge("read only", "neutral"));
        const search = element("input", {
            className: "search-input",
            type: "search",
            value: state.audit.search,
            placeholder: "Cari aktor, tindakan, atau target…",
            attrs: { "aria-label": "Cari audit log" }
        });
        panel.append(element("div", { className: "toolbar toolbar--panel" }, element("span", { className: "search-wrap" }, search)));
        const table = makeTable(["Aktor", "Tindakan", "Target", "Perubahan", "Alamat IP", "Waktu"]);
        const footer = element("footer", { className: "panel__footer" });

        const drawRows = () => {
            const query = state.audit.search.toLowerCase();
            const filtered = logs.filter((log) => {
                const haystack = `${plainValue(log.actorName, "")} ${plainValue(log.actorEmail, "")} ${plainValue(log.action, "")} ${plainValue(log.targetType, "")} ${plainValue(log.targetId, "")}`.toLowerCase();
                return !query || haystack.includes(query);
            });
            table.tbody.replaceChildren();
            if (!filtered.length) emptyTableRow(table.tbody, 6, "Tidak ada catatan audit yang cocok.");
            filtered.forEach((log) => {
                const changes = `Sebelum: ${jsonSummary(log.before)} | Sesudah: ${jsonSummary(log.after)}`;
                const changeNode = element("span", { className: "truncate", text: changes, title: changes });
                const row = element("tr");
                row.append(
                    tableCell(primaryCell(log.actorName || "Sistem", log.actorEmail)),
                    tableCell(badge(log.action, "info")),
                    tableCell(primaryCell(log.targetType, log.targetId ? `ID: ${log.targetId}` : "")),
                    tableCell(changeNode),
                    tableCell(plainValue(log.ipAddress)),
                    tableCell(formatDate(log.createdAt))
                );
                table.tbody.append(row);
            });
            footer.textContent = `Menampilkan ${filtered.length} dari ${logs.length} catatan terbaru.`;
        };
        search.addEventListener("input", () => { state.audit.search = search.value.trim(); drawRows(); });
        panel.append(table.wrap, footer);
        replaceContent(element("div", { className: "section-stack" }, panel));
        drawRows();
    }

})();
