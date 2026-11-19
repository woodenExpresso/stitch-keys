document.addEventListener("DOMContentLoaded", function () {
    const menuToggle = document.getElementById("menuToggle");
    const sideNav = document.getElementById("sideNav");
    const navBg = document.getElementById("navBg");
    const mainContent = document.getElementById("mainContent");
    const mobileOverlay = document.getElementById("mobileOverlay");
    const root = document.documentElement;
    const pageHeader = document.querySelector(".page-header");

    const defaultSizes = {
        nav: 260,
        header: 72,
    };

    // Sync the CSS variable to the actual rendered header height so there
    // is no dead zone at the start of a drag.
    const actualHeaderHeight = pageHeader.offsetHeight;
    defaultSizes.header = actualHeaderHeight;
    root.style.setProperty("--header-height", `${actualHeaderHeight}px`);
    root.style.setProperty("--header-height-visible", `${actualHeaderHeight}px`);

    // ── Section normalizer ────────────────────────────────────────────────────
    // Loose inline content (text nodes + <br> elements) placed directly inside
    // a <section> — outside any <p> — creates an anonymous block whose very
    // first line is a phantom empty line-box (35 px) caused by the <br> that
    // follows the preceding </p>.  This function:
    //   1. Collects consecutive inline siblings into a buffer.
    //   2. Strips any leading whitespace-only text nodes + the first <br>
    //      (the phantom one) from that buffer.
    //   3. Wraps whatever meaningful content remains in a real <p> element.
    // Result: text after </p><br> (or </p> <br>) lands in the very next cell.
    function normalizeSections() {
        document.querySelectorAll("section").forEach(function (section) {
            let buffer = [];

            function flush() {
                if (!buffer.length) return;

                // Find and skip leading whitespace text nodes and one leading <br>
                let start = 0;
                while (start < buffer.length) {
                    const n = buffer[start];
                    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() === "") {
                        start++;
                    } else if (n.nodeName === "BR") {
                        start++;   // drop the phantom <br>
                        break;
                    } else {
                        break;
                    }
                }

                const toWrap   = buffer.slice(start);
                const toRemove = buffer.slice(0, start);

                const hasMeaningful = toWrap.some(
                    n => (n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "") ||
                         n.nodeName === "BR"
                );

                if (hasMeaningful) {
                    const p = document.createElement("p");
                    section.insertBefore(p, buffer[0]);
                    toWrap.forEach(n => p.appendChild(n));
                }

                toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));
                buffer = [];
            }

            Array.from(section.childNodes).forEach(function (node) {
                const isBlock =
                    node.nodeType === Node.ELEMENT_NODE &&
                    getComputedStyle(node).display !== "inline";
                if (isBlock) {
                    flush();
                } else {
                    buffer.push(node);
                }
            });

            flush();
        });
    }
    normalizeSections();

    // Shift the grid origin so every text line lands between grid lines.
    // line-height === grid cell size (35px), so once the first line is aligned
    // every subsequent line stays aligned automatically.
    // The same shift is applied to the side-nav grid (offset by header height)
    // and a scroll listener keeps the nav grid locked to the content grid.
    let gridShift = 0;

    function syncNavGrid() {
        const headerH = parseFloat(getComputedStyle(root).getPropertyValue("--header-height")) || defaultSizes.header;
        navBg.style.backgroundPositionY = `${headerH + gridShift - window.scrollY}px`;
        // Read the live interpolated translateX so the nav grid moves in
        // lock-step with the content during the CSS open/close transition.
        // tx % 35 is a sawtooth but visually smooth because the grid repeats.
        const tx = new DOMMatrix(getComputedStyle(mainContent).transform).m41;
        const xShift = ((tx % 35) + 35) % 35;   // always positive
        navBg.style.backgroundPositionX = `${xShift}px`;
    }

    function alignGridToText() {
        const firstSection = document.querySelector("section");
        if (!firstSection) return;
        const sectionTop = firstSection.getBoundingClientRect().top + window.scrollY;
        const paddingTop = parseFloat(getComputedStyle(firstSection).paddingTop);
        const textTop = Math.round(sectionTop + paddingTop);
        const cell = 35;
        const remainder = textTop % cell;
        gridShift = remainder === 0 ? 0 : -(cell - remainder);
        mainContent.style.backgroundPositionY = `${gridShift}px`;
        syncNavGrid();
    }
    alignGridToText();

    window.addEventListener("scroll", syncNavGrid, { passive: true });

    sideNav.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener("click", function (e) {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute("href"));
            if (target) {
                const headerHeight = parseFloat(getComputedStyle(root).getPropertyValue("--header-height-visible")) || defaultSizes.header;
                window.scrollTo({
                    top: target.getBoundingClientRect().top + window.scrollY - headerHeight,
                    behavior: "smooth"
                });
            }
        });
    });

    // ── Header resize drag ────────────────────────────────────────────────────
    const resizeHandles = document.querySelectorAll(".resize-handle");
    let activeResize = null;
    let startHeight  = 0;
    let startY       = 0;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    resizeHandles.forEach(function (handle) {
        handle.addEventListener("pointerdown", function (event) {
            event.preventDefault();
            document.body.classList.add("resizing");
            activeResize = event.currentTarget.dataset.resize;
            startY       = event.clientY;
            startHeight  = pageHeader.offsetHeight;
            document.body.style.userSelect = "none";
            event.currentTarget.setPointerCapture(event.pointerId);
        });
    });

    document.addEventListener("pointermove", function (event) {
        if (activeResize !== "header") return;
        const delta     = event.clientY - startY;
        const newHeight = clamp(startHeight + delta, 56, window.innerHeight - 24);
        root.style.setProperty("--header-height", `${newHeight}px`);
        root.style.setProperty("--header-height-visible",
            `${Math.min(newHeight, defaultSizes.header + 50)}px`);
    });

    document.addEventListener("pointerup", function () {
        if (!activeResize) return;
        // Re-enable transitions before snapping so the return animates.
        // The void reflow forces the browser to treat class removal as a
        // separate style update, ensuring the transition actually fires.
        document.body.classList.remove("resizing");
        void document.body.offsetWidth;
        root.style.setProperty("--header-height",         `${defaultSizes.header}px`);
        root.style.setProperty("--header-height-visible", `${defaultSizes.header}px`);
        activeResize = null;
        document.body.style.userSelect = "";
    });

    // Tracks the post-slide-in timer so a rapid close can cancel it.
    let slideInTimer = null;

    // ── Products-text snap logic ─────────────────────────────────────────────
    // As the sidebar opens, CSS transitions the text's padding inward so text
    // reflows into narrower lines. When the content area hits ~19 chars (≈160 px)
    // opacity snaps to 0 instantly (no transition). On close the snap reverses at
    // the same threshold so the text reappears narrow then expands back out.
    var _ptEl       = document.querySelector('.products-text');
    var _ptTimer    = null;
    var _PT_OPEN    = 409;   // total padding when sidebar is open (152 + 257)
    var _PT_CLOSE   = 24;    // total padding when sidebar is closed (12 + 12)
    var _PT_THRESH  = 160;   // content-area px ≈ 19 chars at 1 rem Rubik
    var _PT_DUR     = 400;   // must match the CSS padding transition duration (ms)

    function _ptSnap(opening) {
        if (_ptTimer) { clearTimeout(_ptTimer); _ptTimer = null; }
        var colW      = _ptEl.getBoundingClientRect().width;
        var threshPad = colW - _PT_THRESH;

        if (opening) {
            if (threshPad <= _PT_CLOSE) { _ptEl.classList.add('pt-snap-hidden'); return; }
            if (threshPad >= _PT_OPEN)  { return; }  // wide viewport: text never disappears
            var frac = (threshPad - _PT_CLOSE) / (_PT_OPEN - _PT_CLOSE);
            _ptTimer = setTimeout(function () { _ptEl.classList.add('pt-snap-hidden'); }, frac * _PT_DUR);
        } else {
            if (!_ptEl.classList.contains('pt-snap-hidden')) return;
            var frac2 = (_PT_OPEN - threshPad) / (_PT_OPEN - _PT_CLOSE);
            var delay = (frac2 >= 1) ? 0 : Math.max(0, frac2) * _PT_DUR;
            _ptTimer = setTimeout(function () { _ptEl.classList.remove('pt-snap-hidden'); }, delay);
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    menuToggle.addEventListener("click", function () {
        const isOpen = sideNav.classList.toggle("open");
        navBg.classList.toggle("open", isOpen);

        mainContent.classList.toggle("shifted", isOpen);
        _ptSnap(isOpen);
        menuToggle.classList.toggle("open", isOpen);
        sideNav.setAttribute("aria-hidden", String(!isOpen));
        mobileOverlay.classList.toggle("active", isOpen);

        if (isOpen) {
            // Shuffle the stagger delays so notes arrive in a random order
            // each time the nav opens.
            const delays = [0, 0.1, 0.2, 0.3, 0.4];
            for (let i = delays.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [delays[i], delays[j]] = [delays[j], delays[i]];
            }

            // Pick a fresh random tilt, a fresh random left offset (0–50 px),
            // and a fresh random stagger delay for every note.
            let di = 0;
            sideNav.querySelectorAll(".sticky-note").forEach(function (note) {
                for (let i = 1; i <= 5; i++) {
                    if (note.classList.contains("sticky-note--" + i)) {
                        const rot    = Math.round((Math.random() * 8 - 4) * 10) / 10; // ±4 °
                        const offset = Math.floor(Math.random() * 51);                 // 0–50 px
                        currentRotations[i] = rot;
                        note.style.transform       = `rotate(${rot}deg)`;
                        note.style.marginLeft      = `${offset}px`;
                        note.style.transitionDelay = `${delays[di++]}s`;
                        break;
                    }
                }
            });

            // The stagger transition-delays (up to 0.8 s) bleed into hover-out,
            // making the descend feel sluggish. Zero them out once the last note
            // has finished sliding in so every hover fires instantly after that.
            slideInTimer = setTimeout(function () {
                sideNav.querySelectorAll(".sticky-note").forEach(function (note) {
                    note.style.transitionDelay = "0s";
                });
                slideInTimer = null;
            }, 900); // 0.4 s delay + 0.4 s duration + small buffer
        } else {
            // Cancel the timer if the nav is closed before it fires.
            if (slideInTimer) { clearTimeout(slideInTimer); slideInTimer = null; }

            // Clear inline styles so CSS can drive the close animation.
            sideNav.querySelectorAll(".sticky-note").forEach(function (note) {
                note.style.transform       = "";
                note.style.transition      = "";
                note.style.marginLeft      = "";
                note.style.transitionDelay = ""; // restore CSS stagger for next open
            });
        }
    });

    // ── Sticky-note individual drag + snap-back ───────────────────────────────
    // Hold any note → drag it freely around the screen.
    // Release → it transitions back to its resting rotation in 1 s.
    // A tiny movement threshold (5 px) distinguishes a drag from a tap so
    // clicking still triggers the smooth-scroll navigation.
    //
    // currentRotations is a shared mutable map so that fresh random tilts set
    // on each open are instantly visible to the drag handlers of every note.
    const currentRotations = { 1: -2, 2: 1.5, 3: -1, 4: 2, 5: -1.5 };

    sideNav.querySelectorAll(".sticky-note").forEach(function (note) {
        let noteIndex = 0;
        for (let i = 1; i <= 5; i++) {
            if (note.classList.contains("sticky-note--" + i)) { noteIndex = i; break; }
        }

        let dragging  = false;
        let hasMoved  = false;
        let ox = 0, oy = 0;   // pointer start coords

        note.addEventListener("dragstart", function (e) {
            e.preventDefault();
        });

        note.addEventListener("pointerdown", function (e) {
            if (!sideNav.classList.contains("open")) return;
            dragging = true;
            hasMoved = false;
            ox = e.clientX;
            oy = e.clientY;
            note.setPointerCapture(e.pointerId);
            note.style.transition = "box-shadow 0.2s ease";
            note.style.zIndex     = "200";
        });

        note.addEventListener("pointermove", function (e) {
            if (!dragging) return;
            const dx = e.clientX - ox;
            const dy = e.clientY - oy;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
            if (hasMoved) {
                note.style.transform = `translate(${dx}px, ${dy}px) rotate(${currentRotations[noteIndex]}deg)`;
            }
        });

        note.addEventListener("pointerup", function () {
            if (!dragging) return;
            dragging = false;
            // Snap back to resting rotation over 1 s
            note.style.transition = "transform 1s ease, box-shadow 0.2s ease";
            note.style.transform  = `rotate(${currentRotations[noteIndex]}deg)`;
            setTimeout(function () {
                // Re-apply the current rotation as an inline style so it
                // persists correctly if the nav is still open.
                note.style.transform  = `rotate(${currentRotations[noteIndex]}deg)`;
                note.style.transition = "";
                note.style.zIndex     = "";
            }, 1050);
        });

        // Block the scroll-nav click if the user was dragging
        note.addEventListener("click", function (e) {
            if (hasMoved) {
                e.preventDefault();
                e.stopImmediatePropagation();
                hasMoved = false;
            }
        }, true);   // capture phase → runs before the scroll handler below
    });

    // ── Header spring-scroll physics (scroll-up only) ─────────────────────────
    // Scrolling up injects negative velocity into the spring, pushing the header
    // downward. The underdamped spring overshoots and settles back to rest.
    // Scrolling down is ignored — the header stays fixed.
    let springOffset   = 0;
    let springVelocity = 0;

    const SPRING_K    = 0.1;
    const SPRING_C    = 0.5;
    const SCROLL_SENS = 0.4;
    const MAX_SLIDE   = 60;

    let lastScrollY = window.scrollY;

    window.addEventListener("scroll", function () {
        const current = window.scrollY;
        const delta   = current - lastScrollY;
        lastScrollY   = current;
        if (delta < 0) {                          // scrolling up only
            springVelocity += delta * SCROLL_SENS;
        }
    }, { passive: true });

    (function tickHeader() {
        const accel     = -SPRING_K * springOffset - SPRING_C * springVelocity;
        springVelocity += accel;
        springOffset   += springVelocity;
        springOffset    = Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, springOffset));
        pageHeader.style.transform = `translateY(${-springOffset}px)`;
        syncNavGrid();
        requestAnimationFrame(tickHeader);
    }());

    // ── #outro How section ────────────────────────────────────────────────────
    (function () {
        const howOverlay     = document.getElementById("howOverlay");
        const howLabelSq     = document.getElementById("howLabelSquare");
        const howActiveSq    = document.getElementById("howActiveSquare");
        const howActiveText  = document.getElementById("howActiveText");
        const howOptionsCont = document.getElementById("howOptions");
        const howDescText    = document.getElementById("howDescText");

        if (!howOverlay || !howLabelSq || !howActiveSq) return;

        const HOW_COLORS = {
            attach:      "#E8D5B0",   // warm golden beige
            configure:   "#D8CBB2",   // cooler linen beige
            connect:     "#EDD49C",   // amber honey beige
            electronics: "#CECCB8"    // sage parchment beige
        };

        const HOW_CONTENT = {
            attach: {
                label: "they attach",
                desc:  "Each key has 4 magnetic pogo connectors. These magnets allow you to attach & detach these keys easily. Once they snap together, they are able to get and send information to the hub."
            },
            connect: {
                label: "many can i connect",
                desc:  "One key attached to the hub will grant you 77 hours. Having two keys will last you about 71 hours. 20 keys will last you 31 hours, 21 keys will last you 30 hours, reducing by 1 per key you add. The hub is the main computer of the keyboard."
            },
            configure: {
                label: "to configure",
                desc:  "You will need to connect your keyboard to an electronic with access to a search engine (google) & go to this website’s configure section. It’s a tab on the top. You can reach out to us to help you configure your keys, or go to this page to learn how it works."
            },
            electronics: {
                label: "to connect to electronics",
                desc:  "Get a USB-C to USB-C cable to connect directly to an electronic, or you can use Bluetooth. The hub will gather all of the information of the keys and send them to your electronic."
            }
        };

        const ALL_KEYS     = ["attach", "connect", "configure", "electronics"];
        let howActiveKey   = "attach";
        let howMenuOpen    = false;
        let swapInProgress = false;

        var CONNECT_CELLS = [
            { text: "many", col: 1, row: 1, ck: "many" },
            { text: "can",  col: 2, row: 1, ck: "can"  },
            { text: "Conn", col: 3, row: 1, ck: "conn" },
            { text: "ect",  col: 4, row: 1, ck: "ect"  },
            { text: "I",    col: 1, row: 2, ck: "i"    }
        ];

        var CONFIGURE_CELLS = [
            { text: "to",    col: 1, row: 1 },
            { text: "confi", col: 1, row: 2 },
            { text: "gure",  col: 2, row: 2 }
        ];

        var ELECTRONICS_CELLS = [
            { text: "to",      col: 1, row: 1, ck: "to1"    },
            { text: "conn",    col: 2, row: 1, ck: "conn"   },
            { text: "ect",     col: 3, row: 1, ck: "ect"    },
            { text: "to",      col: 4, row: 1, ck: "to2"    },
            { text: "elect",   col: 1, row: 2, ck: "elect"  },
            { text: "ronics",  col: 2, row: 2, ck: "ronics" }
        ];

        function applyColor(container, key) {
            var color = HOW_COLORS[key] || HOW_COLORS.attach;
            container.querySelectorAll(".how-option-cell, .how-option-half").forEach(function (el) {
                el.style.background = color;
            });
        }

        function makeCells(parent, cells, cls) {
            cells.forEach(function (c) {
                var cell = document.createElement("div");
                cell.className = cls;
                cell.textContent = c.text;
                cell.style.gridColumn = c.col;
                cell.style.gridRow    = c.row;
                if (c.ck) cell.dataset.ck = c.ck;
                parent.appendChild(cell);
            });
        }

        function animateConnectCells() {
            var conn = howActiveSq.querySelector("[data-ck='conn']");
            var ect  = howActiveSq.querySelector("[data-ck='ect']");
            var iSq  = howActiveSq.querySelector("[data-ck='i']");
            if (!conn || !ect || !iSq) return;
            var p1 = 3 / 7; // 300ms / 700ms total
            [conn, ect].forEach(function (el) {
                el.animate([
                    { transform: "translateY(0px)",          easing: "ease-in-out", offset: 0   },
                    { transform: "translateY(28.5px)",        easing: "ease-in-out", offset: p1  },
                    { transform: "translate(30px, 28.5px)",   offset: 1 }
                ], { duration: 700, fill: "forwards" });
            });
            iSq.animate([
                { transform: "translateX(0px)",   easing: "ease-in-out", offset: 0   },
                { transform: "translateX(61px)",   easing: "ease-in-out", offset: p1  },
                { transform: "translateX(91px)",   offset: 1 }
            ], { duration: 700, fill: "forwards" });
        }

        function animateElectronicsCells() {
            var elect  = howActiveSq.querySelector("[data-ck='elect']");
            var ronics = howActiveSq.querySelector("[data-ck='ronics']");
            var conn   = howActiveSq.querySelector("[data-ck='conn']");
            var ect    = howActiveSq.querySelector("[data-ck='ect']");
            if (!elect || !ronics || !conn || !ect) return;
            [elect, ronics].forEach(function (el) {
                el.animate([
                    { transform: "translateX(0px)"   },
                    { transform: "translateX(189px)"  }
                ], { duration: 300, easing: "ease-in-out", fill: "forwards" });
            });
            setTimeout(function () {
                [conn, ect].forEach(function (el) {
                    el.animate([
                        { transform: "translateY(0px)"    },
                        { transform: "translateY(28.5px)" }
                    ], { duration: 200, easing: "ease-in-out", fill: "forwards" });
                });
            }, 200);
        }

        function updateActiveSquare(key) {
            howActiveSq.classList.remove("active-split", "active-configure", "active-connect", "active-electronics");
            howActiveSq.innerHTML = "";

            if (key === "attach") {
                howActiveSq.classList.add("active-split");
                ["they", "attach"].forEach(function (word) {
                    var half = document.createElement("div");
                    half.className = "how-option-half";
                    half.textContent = word;
                    howActiveSq.appendChild(half);
                });
            } else if (key === "configure") {
                howActiveSq.classList.add("active-configure");
                makeCells(howActiveSq, CONFIGURE_CELLS, "how-option-cell");
            } else if (key === "connect") {
                howActiveSq.classList.add("active-connect");
                makeCells(howActiveSq, CONNECT_CELLS, "how-option-cell");
            } else if (key === "electronics") {
                howActiveSq.classList.add("active-electronics");
                makeCells(howActiveSq, ELECTRONICS_CELLS, "how-option-cell");
            } else {
                howActiveSq.innerHTML = '<span id="howActiveText">' + HOW_CONTENT[key].label + "</span>";
            }
            applyColor(howActiveSq, key);
        }

        // Set initial appearance
        updateActiveSquare(howActiveKey);

        function openMenu() {
            if (howMenuOpen || swapInProgress) return;
            howMenuOpen = true;

            howOverlay.classList.add("active");
            howActiveSq.classList.add("menu-open");

            // Build option squares for the three non-active topics
            howOptionsCont.innerHTML = "";
            const optionKeys = ALL_KEYS.filter(function (k) { return k !== howActiveKey; });
            optionKeys.forEach(function (key, i) {
                const el = document.createElement("div");
                el.className = "how-option";
                if (i === 1) el.classList.add("how-option--indent");
                el.dataset.key = key;

                if (key === "attach") {
                    el.classList.add("how-option--split");
                    ["they", "attach"].forEach(function (word) {
                        var half = document.createElement("div");
                        half.className = "how-option-half";
                        half.textContent = word;
                        el.appendChild(half);
                    });
                } else if (key === "configure") {
                    el.classList.add("how-option--configure");
                    makeCells(el, CONFIGURE_CELLS, "how-option-cell");
                } else if (key === "connect") {
                    el.classList.add("how-option--connect");
                    makeCells(el, CONNECT_CELLS, "how-option-cell");
                } else if (key === "electronics") {
                    el.classList.add("how-option--electronics");
                    makeCells(el, ELECTRONICS_CELLS, "how-option-cell");
                } else {
                    el.textContent = HOW_CONTENT[key].label;
                }
                applyColor(el, key);
                const rot = ((Math.random() * 10) - 5).toFixed(1);
                el.style.transform = "rotate(" + rot + "deg)";
                el.addEventListener("click", function (e) {
                    e.stopPropagation();
                    onOptionClick(key, el);
                });
                howOptionsCont.appendChild(el);

                // Staggered fade-in
                setTimeout(function () { el.classList.add("visible"); }, i * 90);
            });

            howOptionsCont.classList.add("visible");
            howOptionsCont.setAttribute("aria-hidden", "false");
        }

        function closeMenu(afterClosed) {
            if (!howMenuOpen) return;
            howMenuOpen = false;

            howOverlay.classList.remove("active");

            // Fade each option out
            howOptionsCont.querySelectorAll(".how-option").forEach(function (el) {
                el.classList.remove("visible");
            });
            howOptionsCont.classList.remove("visible");
            howOptionsCont.setAttribute("aria-hidden", "true");

            // Clean up after the CSS transition finishes
            setTimeout(function () {
                howOptionsCont.innerHTML = "";
                howActiveSq.classList.remove("menu-open");
                if (afterClosed) afterClosed();
            }, 300);
        }

        function onOptionClick(key, optEl) {
            if (swapInProgress || !howMenuOpen) return;
            swapInProgress = true;

            // Measure screen positions before any DOM change
            const rectA = howActiveSq.getBoundingClientRect();
            const rectB = optEl.getBoundingClientRect();
            const dx    = rectB.left - rectA.left;
            const dy    = rectB.top  - rectA.top;

            // Capture old appearance before the DOM update
            const oldClassName = howActiveSq.className;
            const oldInnerHTML = howActiveSq.innerHTML;

            const oldKey = howActiveKey;
            howActiveKey = key;

            // Update active square label/layout immediately
            updateActiveSquare(key);

            // FLIP: jump active square to option's screen position, then animate back
            howActiveSq.style.transition = "none";
            howActiveSq.style.transform  = "translate(" + dx + "px, " + dy + "px)";
            void howActiveSq.offsetWidth;
            howActiveSq.style.transition = "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
            howActiveSq.style.transform  = "";

            // Ghost: mirrors the old active square's actual layout and travels toward option
            const ghost = document.createElement("div");
            ghost.className = oldClassName;
            ghost.innerHTML = oldInnerHTML;
            ghost.style.cssText =
                "position:fixed;" +
                "left:" + rectA.left + "px;" +
                "top:" + rectA.top + "px;" +
                "width:" + rectA.width + "px;" +
                "height:" + rectA.height + "px;" +
                "margin:0;" +
                "animation:none;" +
                "translate:0px 0;" +
                "transition:none;" +
                "z-index:22;" +
                "pointer-events:none;";
            document.body.appendChild(ghost);
            void ghost.offsetWidth;
            ghost.style.transition = "transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease";
            ghost.style.transform  = "translate(" + dx + "px, " + dy + "px)";
            ghost.style.opacity    = "0";

            setTimeout(function () {
                ghost.remove();
                howActiveSq.style.transition = "";
                howActiveSq.style.transform  = "";
                swapInProgress = false;
                closeMenu(function () {
                    howDescText.textContent = HOW_CONTENT[howActiveKey].desc;
                    if (howActiveKey === "connect") animateConnectCells();
                    if (howActiveKey === "electronics") animateElectronicsCells();
                    if (window._startDecoAnim) window._startDecoAnim();
                });
            }, 420);
        }

        // ── Decorative 6-square animation ─────────────────────────────────────
        var howDecoCont = document.getElementById("howDeco");
        var decoStarted = false;

        if (howDecoCont) {
            // Current transform offsets for each square (px from their grid cell origin)
            var dPos = {
                tap:    { x: 0, y: 0 },
                on:     { x: 0, y: 0 },
                they:   { x: 0, y: 0 },
                can:    { x: 0, y: 0 },
                it:     { x: 0, y: 0 },
                attach: { x: 0, y: 0 }
            };

            // ── Tuning constants (all in px) ──────────────────────────────
            var DH  = 61;   // one column step (cell ≈57px + 4px gap)
            var DV  = 57;   // one row step (≈ cell height)
            var DHh = 30;   // half-column step
            var DVh = 28;   // half-row step (tap/attach moves)
            // ──────────────────────────────────────────────────────────────

            function dSq(k) { return howDecoCont.querySelector('[data-sq="' + k + '"]'); }
            function dWait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

            function dMove(key, dx, dy, dur, ease) {
                return new Promise(function(resolve) {
                    var el = dSq(key);
                    var x0 = dPos[key].x, y0 = dPos[key].y;
                    dPos[key].x += dx;
                    dPos[key].y += dy;
                    var anim = el.animate([
                        { transform: 'translate(' + x0 + 'px,' + y0 + 'px)' },
                        { transform: 'translate(' + dPos[key].x + 'px,' + dPos[key].y + 'px)' }
                    ], { duration: dur, easing: ease || 'ease-in-out', fill: 'forwards' });
                    anim.onfinish = function() {
                        el.style.transform = 'translate(' + dPos[key].x + 'px,' + dPos[key].y + 'px)';
                        anim.cancel();
                        resolve();
                    };
                });
            }

            function dAll(moves, dur, ease) {
                return Promise.all(moves.map(function(m) { return dMove(m[0], m[1], m[2], dur, ease); }));
            }

            function dLight(keys) {
                howDecoCont.querySelectorAll('.how-deco-cell').forEach(function(el) {
                    el.classList.toggle('light', keys.indexOf(el.dataset.sq) >= 0);
                });
            }

            function dReset() {
                // Snap to the state just before anim1-phase2 (top row shifted left)
                var s = { tap:[-DH,0], on:[-DH,0], they:[-DH,0], can:[0,0], it:[0,0], attach:[0,0] };
                Object.keys(s).forEach(function(k) {
                    dPos[k].x = s[k][0]; dPos[k].y = s[k][1];
                    dSq(k).style.transform = 'translate(' + s[k][0] + 'px,' + s[k][1] + 'px)';
                });
            }

            // Which animation plays next (1–7, then cycles back to 1)
            var decoStep = 0;   // 0 = hasn't started yet
            var decoRunning = false;

            var decoAnims = [
                // Anim 1 ─────────────────────────────────────────────────────
                async function anim1() {
                    if (decoStep === 0) {
                        // Very first trigger: include phase 1 (top row slides left)
                        await dAll([['tap',-DH-4,0],['on',-DH-4,0],['they',-DH-4,0]], 200);
                    }
                    // On loop-back, anim8 already moved everything into position
                    await dAll([['tap',0,DVh],['attach',0,-(DVh+1)]], 200);
                    dLight(['can','it','attach']);
                },
                // Anim 2 ─────────────────────────────────────────────────────
                async function anim2() {
                    await dAll([['tap',0,-DVh],['on',0,-DVh]], 200);
                    await dAll([['can',-DH-4,0],['it',-DH-4,0]], 200);
                    await dMove('it', 0, -DVh, 100);
                    dLight(['tap','on','it']);
                },
                // Anim 3 ─────────────────────────────────────────────────────
                async function anim3() {
                    await dAll([
                        ['tap',DH+4,-DVh],['on',DH+4,-DVh],['they',DH+4,-DVh],
                        ['can',DH+4,-DVh],['it',DH+4,-DVh]
                    ], 300);
                    await dAll([['tap',0,28],['can',0,28],['they',0,28],['attach',0,28],['on',0,-9],['it',0,-9]], 200);
                    dLight(['can','it','attach']);
                },
                // Anim 4 ─────────────────────────────────────────────────────
                async function anim4() {
                    await dAll([['tap',-DH-4,0],['can',-DH-4,0],['it',-DH-4,0]], 200);
                    var p4a = dMove('on', 0, DV+8, 200);
                    await dWait(100);
                    var p4b = dAll([['can',DHh,0],['attach',-DHh,0]], 200);
                    await Promise.all([p4a, p4b]);
                    dLight(['it','on','attach','they']);
                },
                // Anim 5 ─────────────────────────────────────────────────────
                async function anim5() {
                    await dAll([['it',0,-DV-8],['on',0,-DV-8]], 200);
                    await dAll([['it',DHh+4,0],['on',DHh+4,0],['tap',DH+8,0],['can',DH+9,-1]], 200);
                    dLight(['they','on','it']);
                },
                // Anim 6 ─────────────────────────────────────────────────────
                async function anim6() {
                    await dAll([['it',0,-DV-7],['tap',0,-DV-7],['can',0,-DV-7],['on',0,-DV*2-14]], 300);
                    await dAll([['it',DHh,0],['tap',DHh,0],['can',DHh+1,0],['on',-67,0],['attach',-2,0]], 200);
                    dLight(['they','can','attach']);
                },
                // Anim 7 ─────────────────────────────────────────────────────
                async function anim7() {
                    await dAll([['tap',-DH-3,0],['they',-DH-4,0],['can',-DH-4,0],['on',0,DV+8],['it',0,DV+5]], 200);
                    await dAll([['tap',-29,-3],['attach',32,-4],['on',-28,0]], 200);
                    await dAll([['on',3,DV+4],['attach',0,1],['can',0,57+4],['they',0,57+4],['it',5+3,0]], 150);
                    await dAll([['tap',28,57+6],['it',28,57+6],['on',28,57+6]], 200);
                    dLight(['tap','on','it','they','can']);
                },
                // Anim 8 — transition back to loop-start ─────────────────────
                async function anim8() {
                    // Target: top row at same offset as anim1's phase 1, rest at 0
                    var target = {
                        tap: [-(DH+4), 0], on: [-(DH+4), 0], they: [-(DH+4), 0],
                        can: [0, 0], it: [0, 0], attach: [0, 0]
                    };
                    var moves = Object.keys(target).map(function(k) {
                        return [k, target[k][0] - dPos[k].x, target[k][1] - dPos[k].y];
                    });
                    await dAll(moves, 500);
                    dLight(['tap','on','they','attach']);
                }
            ];

            window._startDecoAnim = function() {
                if (decoRunning) return;
                decoRunning = true;
                var idx = decoStep % decoAnims.length;
                decoAnims[idx]().then(function() {
                    decoStep++;
                    decoRunning = false;
                });
            };
        }
        // ──────────────────────────────────────────────────────────────────────

        // Click overlay: close menu
        howOverlay.addEventListener("click", function () {
            if (!swapInProgress) closeMenu();
        });

        // Click active square: toggle menu
        howActiveSq.addEventListener("click", function () {
            if (howMenuOpen) { closeMenu(); } else { openMenu(); }
        });

        // Click "How" square: spawn floating "How" text near the square
        howLabelSq.addEventListener("click", function () {
            const rect  = howLabelSq.getBoundingClientRect();
            const cx    = rect.left + rect.width  / 2;
            const cy    = rect.top  + rect.height / 2;
            const angle = Math.random() * 2 * Math.PI;
            const dist  = 60 + Math.random() * 140;
            const tx    = cx + Math.cos(angle) * dist;
            const ty    = cy + Math.sin(angle) * dist;
            const rot   = ((Math.random() * 30) - 15).toFixed(1);

            const el = document.createElement("div");
            el.textContent = "How";
            el.style.cssText =
                "position:fixed;" +
                "left:" + tx + "px;" +
                "top:" + ty + "px;" +
                "transform:translate(-50%,-50%) rotate(" + rot + "deg);" +
                "color:#3d4349;" +
                "font-family:'Exo 2',sans-serif;" +
                "font-weight:700;" +
                "font-size:1.5rem;" +
                "pointer-events:none;" +
                "z-index:22;" +
                "opacity:1;" +
                "transition:opacity 0.8s ease;";
            document.body.appendChild(el);
            void el.offsetWidth;
            el.style.opacity = "0";
            setTimeout(function () { el.remove(); }, 820);
        });
    }());

    // ── Title letter squares ──────────────────────────────────────────────────
    document.querySelectorAll(".letter-square").forEach(function (sq) {
        if (sq.id === "titleLetterS") return;
        sq.addEventListener("click", function () {
            const rect  = sq.getBoundingClientRect();
            const cx    = rect.left + rect.width  / 2;
            const cy    = rect.top  + rect.height / 2;
            const angle = Math.random() * 2 * Math.PI;
            const dist  = 60 + Math.random() * 140;
            const tx    = cx + Math.cos(angle) * dist;
            const ty    = cy + Math.sin(angle) * dist;
            const rot   = ((Math.random() * 30) - 15).toFixed(1);

            const el = document.createElement("div");
            el.textContent = sq.dataset.letter;
            el.style.cssText =
                "position:fixed;" +
                "left:" + tx + "px;" +
                "top:" + ty + "px;" +
                "transform:translate(-50%,-50%) rotate(" + rot + "deg);" +
                "color:#9a8a6a;" +
                "font-family:'Exo 2',sans-serif;" +
                "font-weight:700;" +
                "font-size:3rem;" +
                "pointer-events:none;" +
                "z-index:999;" +
                "opacity:1;" +
                "transition:opacity 0.8s ease;";
            document.body.appendChild(el);
            void el.offsetWidth;
            el.style.opacity = "0";
            setTimeout(function () { el.remove(); }, 820);
        });
    });

    // ── "S" square animation ──────────────────────────────────────────────────
    var letterS = document.getElementById("titleLetterS");
    if (letterS) {
        letterS.addEventListener("click", function () {
            if (letterS.dataset.animating) return;
            letterS.dataset.animating = "true";

            var anim = letterS.animate([
                { transform: "translateX(0px)   rotate(0deg)",   easing: "ease-out" },
                { transform: "translateX(-20px) rotate(0deg)",   easing: "linear",      offset: 0.18 },
                { transform: "translateX(-20px) rotate(360deg)", easing: "ease-in-out", offset: 0.80 },
                { transform: "translateX(0px)   rotate(360deg)"                                      }
            ], { duration: 900, fill: "none" });

            anim.onfinish = function () { delete letterS.dataset.animating; };
        });
    }

    var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzMXRphcVfPYyCFxxai_Cc2ybqQebWTOn5hcWIVIF7xvjk2zGA84DIVFZGX97GlnQEevA/exec';

    // Valid TLDs for US, English-speaking, and Spanish-speaking countries.
    var VALID_TLDS = new Set([
        // Generic
        'com','net','org','edu','gov','mil','int','info','biz','name','pro',
        'aero','coop','museum','mobi','tel','travel','jobs','post',
        // New generic
        'io','co','app','dev','tech','online','store','shop','site','media',
        'digital','news','blog','email','cloud','ai','design','studio','agency',
        'services','solutions','finance','health','care','legal','law','money',
        'market','capital','ventures','holdings','software','systems','group',
        'global','world','live','me','tv','cc','fm','ws','click','link','page',
        // English-speaking country codes
        'us','uk','gb','ca','au','nz','ie','za','sg','ph','ng','ke','gh',
        'jm','tt','bb','bz','gy','zm','zw','bw','ls','na','sz','mw','mu',
        'sc','fj','pg','sb','to','vu','ck','nu',
        // Spanish-speaking country codes
        'mx','es','ar','cl','pe','ve','ec','bo','py','uy','cr','gt','hn',
        'sv','ni','pa','cu','do','pr','gq'
    ]);

    function isValidEmailTLD(email) {
        var lower = email.trim().toLowerCase();
        var atIdx = lower.lastIndexOf('@');
        if (atIdx < 1) { return false; }
        var domain = lower.slice(atIdx + 1);
        if (!domain || domain.indexOf('.') === -1) { return false; }
        var parts = domain.split('.');
        var tld = parts[parts.length - 1];
        return VALID_TLDS.has(tld);
    }

    function submitEmail(email) {
        fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
    }

    var signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var email = signupForm.querySelector('input[name="email"]').value;
            submitEmail(email);
            signupForm.hidden = true;
            document.getElementById('signupThanks').hidden = false;
        });
    }

    var signupPageForm = document.getElementById('signupPageForm');
    if (signupPageForm) {
        signupPageForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var emailInput = document.getElementById('signupPageEmail');
            var errorEl   = document.getElementById('signupPageError');
            var thanksEl  = document.getElementById('signupPageThanks');
            var email = emailInput.value.trim();
            if (!isValidEmailTLD(email)) {
                errorEl.hidden = false;
                emailInput.focus();
                return;
            }
            errorEl.hidden = true;
            submitEmail(email);
            signupPageForm.hidden = true;
            if (thanksEl) {
                thanksEl.removeAttribute('hidden');
                thanksEl.style.display = 'block';
            }
        });
        document.getElementById('signupPageEmail').addEventListener('input', function () {
            document.getElementById('signupPageError').hidden = true;
        });
    }

    // ── Configure page ──────────────────────────────────────────────────────
    var CONFIGURE_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbzKSHLZICDwF2uI797DX8BFvpNOMSm2hgeRl1TXZauVc08XRhSQM5OvuW9xtG7dEhNHrg/exec';

    var cfgSessionId = (function() {
        try {
            var id = localStorage.getItem('sk_session_id');
            if (!id) {
                id = 'sk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                localStorage.setItem('sk_session_id', id);
            }
            return id;
        } catch(e) { return 'anon' + Date.now(); }
    })();

    // Block Builder data (must be declared before initConfigurePage runs)
    // SVG block shape constants
    var BB_R = 3, BB_NX = 14, BB_NW = 15, BB_NH = 4, BB_BH = 44;

    var BB_CATS = [
        { id: 'trigger',  label: 'Triggers',  color: '#c27820' },
        { id: 'keyboard', label: 'Keyboard',  color: '#2d6cb8' },
        { id: 'system',   label: 'System',    color: '#7040c0' },
        { id: 'layer',    label: 'Layer',     color: '#b85818' },
        { id: 'flow',     label: 'Flow',      color: '#1a9068' }
    ];
    var BB_BLOCKS = {
        on_press:       { cat: 'trigger',  hat: true,  label: 'When key is pressed',       inputs: [] },
        on_hold:        { cat: 'trigger',  hat: true,  label: 'When key is held',          inputs: [{ key: 'ms',     type: 'num',      default: 500, unit: 'ms' }] },
        on_double_tap:  { cat: 'trigger',  hat: true,  label: 'When double-tapped within', inputs: [{ key: 'ms',     type: 'num',      default: 300, unit: 'ms' }] },
        on_release:     { cat: 'trigger',  hat: true,  label: 'When key is released',      inputs: [] },
        on_layer:       { cat: 'trigger',  hat: true,  label: 'When layer activates',      inputs: [{ key: 'layer',  type: 'layer_sel' }] },
        press_shortcut: { cat: 'keyboard',             label: 'Press',                     inputs: [{ key: 'combo',  type: 'shortcut' }] },
        type_text:      { cat: 'keyboard',             label: 'Type',                      inputs: [{ key: 'text',   type: 'text' }] },
        hold_key:       { cat: 'keyboard',             label: 'Hold',                      inputs: [{ key: 'combo',  type: 'shortcut' }] },
        release_key:    { cat: 'keyboard',             label: 'Release',                   inputs: [{ key: 'combo',  type: 'shortcut' }] },
        open_url:       { cat: 'system',               label: 'Open URL',                  inputs: [{ key: 'url',    type: 'text' }] },
        volume:         { cat: 'system',               label: 'Volume',                    inputs: [{ key: 'action', type: 'select',    options: ['Up','Down','Mute','Toggle'] }] },
        media:          { cat: 'system',               label: 'Media',                     inputs: [{ key: 'action', type: 'select',    options: ['Play-Pause','Next','Previous','Stop'] }] },
        screenshot:     { cat: 'system',               label: 'Screenshot',                inputs: [{ key: 'mode',   type: 'select',    options: ['Full','Window','Selection'] }] },
        layer_switch:   { cat: 'layer',                label: 'Switch to layer',           inputs: [{ key: 'layer',  type: 'layer_sel' }] },
        layer_toggle:   { cat: 'layer',                label: 'Toggle layer',              inputs: [{ key: 'layer',  type: 'layer_sel' }] },
        layer_hold:     { cat: 'layer',                label: 'Hold layer',                inputs: [{ key: 'layer',  type: 'layer_sel' }] },
        wait:           { cat: 'flow',                 label: 'Wait',                      inputs: [{ key: 'ms',     type: 'num',      default: 100, unit: 'ms' }] },
        repeat:         { cat: 'flow',                 label: 'Repeat',                    inputs: [{ key: 'times',  type: 'num',      default: 3,   unit: '×' }] },
        stop:           { cat: 'flow',                 label: 'Stop',                      inputs: [] }
    };
    var bbScripts    = {};
    var bbActiveKey  = null;
    var bbActiveLyr  = 0;
    var bbLayers     = [{ id: 0, name: 'Layer 1' }];
    var bbLayerCount = 1;
    var bbDragType   = null;
    var bbNextId     = 1;
    var bbGhost      = null;
    var bbDropIdx    = -1;

    if (document.body.classList.contains('page--configure')) {
        initConfigurePage();
    }

    function initConfigurePage() {
        if (!('serial' in navigator)) {
            document.getElementById('cfgBrowserNote').textContent =
                'Web Serial requires Chrome or Edge on a desktop computer.';
            document.getElementById('cfgConnectBtn').disabled = true;
        }
        document.getElementById('cfgConnectBtn').addEventListener('click', handleConnect);
        document.getElementById('cfgDemoBtn').addEventListener('click', simulateConnect);
        document.getElementById('cfgPushBtn').addEventListener('click', pushKeymapOverSerial);
        document.getElementById('cfgBuildBtn').addEventListener('click', handleBuild);
        document.getElementById('cfgSaveBtn').addEventListener('click', saveLayoutToCloud);
        document.getElementById('cfgMapBtn').addEventListener('click', openMapper);
        document.getElementById('cfgMapperClose').addEventListener('click', closeMapper);
        document.getElementById('cfgLoadBtn').addEventListener('click', function () {
            var code = document.getElementById('cfgLayoutCode').value.trim().toUpperCase();
            if (code.length !== 6) {
                var s = document.getElementById('cfgLoadStatus');
                s.textContent = 'Enter a 6-character code.';
                s.className = 'cfg-status cfg-status--error';
                return;
            }
            loadLayoutFromCloud(code);
        });
        document.getElementById('cfgLayoutCode').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') document.getElementById('cfgLoadBtn').click();
        });
        // Pre-fill code if one was saved last time
        try {
            var saved = localStorage.getItem('lastLayoutCode');
            if (saved) document.getElementById('cfgLayoutCode').value = saved;
        } catch (e) {}
        document.getElementById('cfgModalCancel').addEventListener('click', closeModal);
        document.getElementById('cfgModalSave').addEventListener('click', saveModal);
        document.getElementById('cfgRestartBtn').addEventListener('click', function () {
            renderGrid();
            showCfgStep('cfgStepAssign');
            openMapper();
        });
        // All pane tabs via data-pane
        document.querySelectorAll('.cfg-cat-tab[data-pane]').forEach(function(tab) {
            tab.addEventListener('click', function() { showPickerPane(tab.dataset.pane); });
        });
        // Block Builder tab (toggles in/out of Block Builder view)
        document.getElementById('cfgTabBlockBuilderBtn').addEventListener('click', function() {
            var inBB = !document.getElementById('cfgViewBlockBuilder').classList.contains('cfg-step--hidden');
            showPageTab(inBB ? 'configure' : 'blockbuilder');
        });
        initBlockBuilder();
        // KB badge buttons
        document.querySelectorAll('.cfg-badge').forEach(function(badge) {
            badge.addEventListener('click', function() { renderKbGrid(badge.dataset.badge); });
        });
        // Combo bar
        document.getElementById('cfgComboClear').addEventListener('click', clearCombo);
        document.getElementById('cfgComboAssign').addEventListener('click', assignCombo);
        // Layer pane
        document.getElementById('cfgLayerAddBtn').addEventListener('click', addLayer);
        document.getElementById('cfgLayerDelBtn').addEventListener('click', deleteLayer);
        document.getElementById('cfgLayerAssign').addEventListener('click', assignLayer);
        // Delete confirm
        document.getElementById('cfgConfirmNo').addEventListener('click', function() {
            document.getElementById('cfgConfirmModal').classList.add('cfg-step--hidden');
        });
        document.getElementById('cfgConfirmYes').addEventListener('click', confirmDeleteLayer);
        // Sequence pane
        document.getElementById('cfgSeqAddStep').addEventListener('click', addSeqStep);
        document.getElementById('cfgSeqAssign').addEventListener('click', assignSeq);
        // Physical keyboard capture (active when KB pane is visible)
        document.addEventListener('keydown', onKbPhysicalKey);
        document.addEventListener('keydown', onModalKey);

        // Profile banner buttons
        document.getElementById('cfgProfileSaveBtn').addEventListener('click', beginProfileNameEdit);
        document.getElementById('cfgProfileRenameBtn').addEventListener('click', beginProfileNameEdit);
        document.getElementById('cfgProfileUpdateBtn').addEventListener('click', function() {
            var profile = loadProfiles()[cfgCurrentFingerprint];
            if (profile) saveCurrentProfile(profile.name);
        });
        document.getElementById('cfgProfileConfirmBtn').addEventListener('click', function() {
            var name = document.getElementById('cfgProfileInput').value.trim();
            if (!name) { document.getElementById('cfgProfileInput').focus(); return; }
            saveCurrentProfile(name);
        });
        document.getElementById('cfgProfileCancelBtn').addEventListener('click', function() {
            var profile = loadProfiles()[cfgCurrentFingerprint];
            showProfileBanner(profile ? 'known' : 'new', profile ? profile.name : '');
        });
        document.getElementById('cfgProfileInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter')  document.getElementById('cfgProfileConfirmBtn').click();
            if (e.key === 'Escape') document.getElementById('cfgProfileCancelBtn').click();
        });

        // Session restore banner
        checkSessionRestore();

        // Inject "Browse Presets" button into action bar
        var assignActions = document.querySelector('.cfg-assign-actions');
        if (assignActions) {
            var presetsBtn = document.createElement('button');
            presetsBtn.className = 'cfg-btn cfg-btn--secondary';
            presetsBtn.id = 'cfgPresetsBtn';
            presetsBtn.textContent = 'Browse Presets';
            presetsBtn.addEventListener('click', openPresetsModal);
            assignActions.insertBefore(presetsBtn, document.getElementById('cfgMapBtn'));
        }
    }

    // ── Special category (media + launch + text + system) ────────────────────
    var CFG_SPECIAL = [
        // media
        { zmk: 'C_PLAY_PAUSE', display: 'Play/Pause', cat: 'media' },
        { zmk: 'C_NEXT',       display: 'Next',        cat: 'media' },
        { zmk: 'C_PREV',       display: 'Previous',    cat: 'media' },
        { zmk: 'C_VOL_UP',    display: 'Vol +',        cat: 'media' },
        { zmk: 'C_VOL_DN',    display: 'Vol -',        cat: 'media' },
        { zmk: 'C_MUTE',      display: 'Mute',          cat: 'media' },
        { zmk: 'C_BRI_UP',    display: 'Bright +',      cat: 'media' },
        { zmk: 'C_BRI_DN',    display: 'Bright -',      cat: 'media' },
        // launch
        { zmk: 'LG(LS(S))',   display: 'Screenshot',   cat: 'launch' },
        { zmk: 'LG(E)',        display: 'Files',         cat: 'launch' },
        { zmk: 'LG(I)',        display: 'Settings',      cat: 'launch' },
        { zmk: 'LG(R)',        display: 'Run',           cat: 'launch' },
        { zmk: 'LC(LS(ESC))', display: 'Task Mgr',      cat: 'launch' },
        // system
        { zmk: 'LG(L)',        display: 'Lock',          cat: 'system' },
        { zmk: 'LG(D)',        display: 'Desktop',       cat: 'system' },
        { zmk: 'LG(TAB)',     display: 'Task View',      cat: 'system' },
        { zmk: 'LA(TAB)',     display: 'Alt+Tab',        cat: 'system' },
        { zmk: 'LA(F4)',      display: 'Close App',      cat: 'system' },
        { zmk: 'PRINTSCREEN', display: 'PrtSc',          cat: 'system' },
        // text
        { zmk: 'LC(C)',        display: 'Copy',          cat: 'text' },
        { zmk: 'LC(V)',        display: 'Paste',         cat: 'text' },
        { zmk: 'LC(Z)',        display: 'Undo',          cat: 'text' },
        { zmk: 'LC(LS(Z))',   display: 'Redo',          cat: 'text' },
        { zmk: 'LC(A)',        display: 'Select All',    cat: 'text' },
        { zmk: 'LC(S)',        display: 'Save',          cat: 'text' },
        { zmk: 'LC(F)',        display: 'Find',          cat: 'text' },
        { zmk: 'LC(W)',        display: 'Close Tab',     cat: 'text' },
        { zmk: 'LC(T)',        display: 'New Tab',       cat: 'text' },
        { zmk: 'ENTER',        display: 'Enter',         cat: 'text' },
        { zmk: 'BSPC',         display: 'Backspace',     cat: 'text' },
        { zmk: 'DEL',          display: 'Delete',        cat: 'text' },
        { zmk: 'TAB',          display: 'Tab',           cat: 'text' },
        { zmk: 'ESC',          display: 'Escape',        cat: 'text' },
        { zmk: 'LEFT',         display: 'Left',          cat: 'text' },
        { zmk: 'RIGHT',        display: 'Right',         cat: 'text' },
        { zmk: 'UP',           display: 'Up',            cat: 'text' },
        { zmk: 'DOWN',         display: 'Down',          cat: 'text' },
        { zmk: 'HOME',         display: 'Home',          cat: 'text' },
        { zmk: 'END',          display: 'End',           cat: 'text' },
        { zmk: 'PG_UP',       display: 'Pg Up',          cat: 'text' },
        { zmk: 'PG_DN',       display: 'Pg Dn',          cat: 'text' },
    ];

    // ── Keyboard layout data ─────────────────────────────────────────────────
    var KB_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(function(c) {
        return { zmk: c, display: c };
    });

    var KB_NUMBERS = [
        { zmk: 'N1', display: '1' }, { zmk: 'N2', display: '2' },
        { zmk: 'N3', display: '3' }, { zmk: 'N4', display: '4' },
        { zmk: 'N5', display: '5' }, { zmk: 'N6', display: '6' },
        { zmk: 'N7', display: '7' }, { zmk: 'N8', display: '8' },
        { zmk: 'N9', display: '9' }, { zmk: 'N0', display: '0' },
    ];

    var KB_OTHER = [
        { zmk: 'LCTRL',  display: 'Ctrl',   mod: true },
        { zmk: 'LSHFT',  display: 'Shift',  mod: true },
        { zmk: 'LALT',   display: 'Alt',    mod: true },
        { zmk: 'LGUI',   display: 'Win',    mod: true },
        { zmk: 'RCTRL',  display: 'RCtrl',  mod: true },
        { zmk: 'RSHFT',  display: 'RShift', mod: true },
        { zmk: 'RALT',   display: 'RAlt',   mod: true },
        { zmk: 'RGUI',   display: 'RWin',   mod: true },
        { zmk: 'CAPS',   display: 'Caps',   mod: true },
        { zmk: 'TAB',    display: 'Tab' },
        { zmk: 'F1',  display: 'F1' },  { zmk: 'F2',  display: 'F2' },
        { zmk: 'F3',  display: 'F3' },  { zmk: 'F4',  display: 'F4' },
        { zmk: 'F5',  display: 'F5' },  { zmk: 'F6',  display: 'F6' },
        { zmk: 'F7',  display: 'F7' },  { zmk: 'F8',  display: 'F8' },
        { zmk: 'F9',  display: 'F9' },  { zmk: 'F10', display: 'F10' },
        { zmk: 'F11', display: 'F11' }, { zmk: 'F12', display: 'F12' },
        { zmk: 'F13', display: 'F13' }, { zmk: 'F14', display: 'F14' },
        { zmk: 'F15', display: 'F15' }, { zmk: 'F16', display: 'F16' },
        { zmk: 'F17', display: 'F17' }, { zmk: 'F18', display: 'F18' },
        { zmk: 'F19', display: 'F19' }, { zmk: 'F20', display: 'F20' },
        { zmk: 'F21', display: 'F21' }, { zmk: 'F22', display: 'F22' },
        { zmk: 'F23', display: 'F23' }, { zmk: 'F24', display: 'F24' },
        { zmk: 'LEFT',   display: 'Left'  }, { zmk: 'RIGHT', display: 'Right' },
        { zmk: 'UP',     display: 'Up'    }, { zmk: 'DOWN',  display: 'Down'  },
        { zmk: 'HOME',   display: 'Home'  }, { zmk: 'END',   display: 'End'   },
        { zmk: 'PG_UP',  display: 'PgUp'  }, { zmk: 'PG_DN', display: 'PgDn'  },
        { zmk: 'INS',    display: 'Ins'   },
        { zmk: 'BSPC',   display: 'Bspc', wide: true },
        { zmk: 'DEL',    display: 'Del'   },
        { zmk: 'RET',    display: 'Enter', wide: true },
        { zmk: 'ESC',    display: 'Esc'   },
        { zmk: 'SPACE',  display: 'Space', wider: true },
        { zmk: 'GRAVE',  display: '`' },  { zmk: 'MINUS',  display: '-' },
        { zmk: 'EQUAL',  display: '=' },  { zmk: 'LBKT',   display: '[' },
        { zmk: 'RBKT',   display: ']' },  { zmk: 'BSLH',   display: '\\' },
        { zmk: 'SEMI',   display: ';' },  { zmk: 'SQT',    display: "'" },
        { zmk: 'COMMA',  display: ',' },  { zmk: 'DOT',    display: '.' },
        { zmk: 'SLASH',  display: '/' },  { zmk: 'TILDE',  display: '~' },
        { zmk: 'UNDER',  display: '_' },  { zmk: 'PLUS',   display: '+' },
        { zmk: 'LBRC',   display: '{' },  { zmk: 'RBRC',   display: '}' },
        { zmk: 'PIPE',   display: '|' },  { zmk: 'COLON',  display: ':' },
        { zmk: 'DQT',    display: '"' },  { zmk: 'LT',     display: '<' },
        { zmk: 'GT',     display: '>' },  { zmk: 'QMARK',  display: '?' },
        { zmk: 'EXCL',   display: '!' },  { zmk: 'AT',     display: '@' },
        { zmk: 'HASH',   display: '#' },  { zmk: 'DLLR',   display: '$' },
        { zmk: 'PRCNT',  display: '%' },  { zmk: 'CARET',  display: '^' },
        { zmk: 'AMPS',   display: '&' },  { zmk: 'STAR',   display: '*' },
        { zmk: 'LPAR',   display: '(' },  { zmk: 'RPAR',   display: ')' },
        { zmk: 'PRINTSCREEN', display: 'PrtSc' },
        { zmk: 'SCROLLLOCK',  display: 'ScLk' },
        { zmk: 'PAUSE_BREAK', display: 'Pause' },
    ];

    var ZMK_MOD_MAP = { LCTRL: 'LC', LSHFT: 'LS', LALT: 'LA', LGUI: 'LG',
                        RCTRL: 'RC', RSHFT: 'RS', RALT: 'RA', RGUI: 'RG' };

    var cfgKeys      = [];
    var cfgEditIndex = -1;
    var cfgPending   = null;
    var cfgActiveKey = -1;
    var cfgActivePaneId = null;
    var cfgActivePaneBadge = 'letters';
    var cfgSpecialBadge    = 'media';

    // Combo builder state
    var cfgComboMods = [];
    var cfgComboBase = null;

    // Layer state
    var cfgLayers = [{ id: 0, name: 'Default' }];
    var cfgLayerCount = 1;
    var cfgSelectedLayer = 0;

    // Sequence state
    var cfgSeqSteps = [];

    // Mapper & serial state
    var cfgSerialPort    = null;
    var cfgSerialReader  = null;
    var cfgMapperOpen    = false;
    var cfgIsDemo        = false;
    var cfgCurrentFingerprint = '';
    var CFG_PROFILES_KEY      = 'stitchkeys_profiles';
    var kmapKeys          = [];    // [{ x, y, channel, address }] — mirrors active layout
    var kmapPendingPos    = null;  // { x, y } — grid position clicked, waiting for key press
    var kmapBlockAboveHub = true;  // cable-zone restriction
    var kmapLayouts       = [{ id: 0, name: 'Layout 1', keys: [] }];
    var kmapActiveLayoutIdx = 0;
    var kmapLayoutCount   = 1;

    function showCfgStep(id) {
        ['cfgStepConnect', 'cfgStepAssign', 'cfgStepBuild'].forEach(function (s) {
            document.getElementById(s).classList.toggle('cfg-step--hidden', s !== id);
        });
        if (id === 'cfgStepAssign') renderStatsPanel();
    }

    function saveLayoutToCloud() {
        var btn    = document.getElementById('cfgSaveBtn');
        var status = document.getElementById('cfgSaveStatus');
        btn.disabled = true;
        status.textContent = 'Saving…';
        status.className = 'cfg-status';

        callBackend({ action: 'saveLayout', keys: cfgKeys })
            .then(function (res) {
                if (res.error) throw new Error(res.error);
                status.innerHTML =
                    'Saved! Your code: <span class="cfg-code-display">' + res.code + '</span>';
                try { localStorage.setItem('lastLayoutCode', res.code); } catch (e) {}
                btn.disabled = false;
            })
            .catch(function (err) {
                status.textContent = 'Error: ' + (err.message || err);
                status.className = 'cfg-status cfg-status--error';
                btn.disabled = false;
            });
    }

    function loadLayoutFromCloud(code) {
        var status = document.getElementById('cfgLoadStatus');
        status.textContent = 'Loading…';
        status.className = 'cfg-status';

        callBackend({ action: 'loadLayout', code: code })
            .then(function (res) {
                if (res.error) throw new Error(res.error);
                cfgKeys = res.keys;
                renderGrid();
                showCfgStep('cfgStepAssign');
                openMapper();
                status.textContent = '';
                try { localStorage.setItem('lastLayoutCode', code); } catch (e) {}
            })
            .catch(function (err) {
                status.textContent = 'Code not found — check and try again.';
                status.className = 'cfg-status cfg-status--error';
            });
    }

    function simulateConnect() {
        var btn    = document.getElementById('cfgDemoBtn');
        var status = document.getElementById('cfgConnectStatus');
        btn.disabled = true;
        status.className = 'cfg-status';
        status.textContent = 'Simulating connection…';

        // Build 12 realistic demo keys spread across 3 channels (PCF8574PWR: 0x20-0x27)
        var demoLayout = [
            { ch: 0, addr: '0x20' }, { ch: 0, addr: '0x21' }, { ch: 0, addr: '0x22' }, { ch: 0, addr: '0x23' },
            { ch: 1, addr: '0x20' }, { ch: 1, addr: '0x21' }, { ch: 1, addr: '0x22' }, { ch: 1, addr: '0x23' },
            { ch: 2, addr: '0x20' }, { ch: 2, addr: '0x21' }, { ch: 2, addr: '0x22' }, { ch: 2, addr: '0x23' },
        ];

        setTimeout(function () {
            cfgIsDemo = true;
            cfgKeys = demoLayout.map(function (k) {
                return { channel: k.ch, address: k.addr, zmk: '', display: '' };
            });
            renderGrid();
            showCfgStep('cfgStepAssign');
            openMapper();
            // Simulate a fingerprint so the profile banner activates in demo mode
            var demoFp = demoLayout.map(function(k) { return 'ch' + k.ch + ':' + k.addr; }).join(',');
            onLayoutDetected(demoFp);
            status.textContent = '';
            btn.disabled = false;
        }, 900);
    }

    function handleConnect() {
        var btn    = document.getElementById('cfgConnectBtn');
        var status = document.getElementById('cfgConnectStatus');
        btn.disabled = true;
        status.textContent = 'Connecting...';
        status.className = 'cfg-status';
        cfgIsDemo = false;

        navigator.serial.requestPort()
            .then(function (port) {
                cfgSerialPort = port;
                return port.open({ baudRate: 115200 });
            })
            .then(function () {
                var writer = cfgSerialPort.writable.getWriter();
                return writer.write(new TextEncoder().encode('SCAN\n'))
                    .then(function () { writer.releaseLock(); });
            })
            .then(function () {
                startSerialReadLoop();
            })
            .catch(function (err) {
                status.textContent = err.message || String(err);
                status.className = 'cfg-status cfg-status--error';
                btn.disabled = false;
            });
    }

    function startSerialReadLoop() {
        var status = document.getElementById('cfgConnectStatus');
        var btn    = document.getElementById('cfgConnectBtn');
        cfgSerialReader = cfgSerialPort.readable.getReader();
        var buf = '';
        var keysReceived = false;
        var deadline = setTimeout(function () {
            if (!keysReceived) {
                cfgSerialReader.cancel();
                status.textContent = 'No response from keyboard. Is the firmware flashed?';
                status.className = 'cfg-status cfg-status--error';
                btn.disabled = false;
            }
        }, 5000);

        function loop() {
            cfgSerialReader.read().then(function (chunk) {
                if (chunk.done) { cfgSerialReader = null; return; }
                buf += new TextDecoder().decode(chunk.value);
                var lines = buf.split('\n');
                buf = lines.pop();
                lines.forEach(function (line) {
                    line = line.trim();
                    if (!line) return;
                    if (!keysReceived && (line.startsWith('KEYS:') || line.startsWith('LAYOUT:'))) {
                        keysReceived = true;
                        clearTimeout(deadline);
                        var keys = line.startsWith('LAYOUT:') ? parseLayout(line) : parseKeys(line);
                        if (keys.length === 0) {
                            status.textContent = 'No keys detected. Are any keys attached?';
                            status.className = 'cfg-status cfg-status--error';
                            btn.disabled = false;
                            return;
                        }
                        cfgKeys = keys;
                        renderGrid();
                        showCfgStep('cfgStepAssign');
                        openMapper();
                        var pushBtn = document.getElementById('cfgPushBtn');
                        if (pushBtn) pushBtn.classList.remove('cfg-step--hidden');
                        if (line.startsWith('LAYOUT:')) onLayoutDetected(line.slice(7).trim());
                    } else if (keysReceived && line.startsWith('LAYOUT:')) {
                        // Hot-plug: update keys if layout changes while already in configure step
                        var newKeys = parseLayout(line);
                        if (newKeys.length > 0) {
                            cfgKeys = newKeys;
                            renderGrid();
                            onLayoutDetected(line.slice(7).trim());
                        }
                    } else if (line.startsWith('KEY:')) {
                        var parts = line.slice(4).split(':');
                        if (parts.length === 2) {
                            onDeviceKeyPress(parseInt(parts[0], 10), parts[1]);
                        }
                    }
                });
                loop();
            }).catch(function () { cfgSerialReader = null; });
        }
        loop();
    }

    function onDeviceKeyPress(channel, address) {
        if (!cfgMapperOpen || kmapPendingPos === null) return;
        kmapPlaceKey(kmapPendingPos.x, kmapPendingPos.y, channel, address);
        kmapCancelPending();
    }

    function parseKeys(text) {
        if (!text.startsWith('KEYS:')) return [];
        var raw = text.slice(5);
        if (!raw) return [];
        return raw.split(',').map(function (part) {
            var seg = part.split(':');
            return { channel: parseInt(seg[0], 10), address: seg[1], zmk: '', display: '' };
        });
    }

    // Parse the fingerprint module's LAYOUT: lines.
    // Format: "LAYOUT:ch0:0x20,ch0:0x21,ch1:0x23\n"
    function parseLayout(text) {
        if (!text.startsWith('LAYOUT:')) return [];
        var raw = text.slice(7).trim();
        if (!raw || raw === 'empty') return [];
        return raw.split(',').map(function (part) {
            var m = part.match(/^ch(\d+):(0x[0-9a-fA-F]+)$/);
            if (!m) return null;
            return { channel: parseInt(m[1], 10), address: m[2], zmk: '', display: '' };
        }).filter(Boolean);
    }

    // ── Profile DB ──────────────────────────────────────────────────────────

    function loadProfiles() {
        try { return JSON.parse(localStorage.getItem(CFG_PROFILES_KEY) || '{}'); } catch(e) { return {}; }
    }

    function saveProfiles(profiles) {
        try { localStorage.setItem(CFG_PROFILES_KEY, JSON.stringify(profiles)); } catch(e) {}
    }

    function onLayoutDetected(fingerprint) {
        if (!fingerprint || fingerprint === 'empty') return;
        cfgCurrentFingerprint = fingerprint;
        var profiles = loadProfiles();
        var profile  = profiles[fingerprint];

        if (profile && profile.keys) {
            cfgKeys = cfgKeys.map(function(key) {
                var saved = null;
                for (var i = 0; i < profile.keys.length; i++) {
                    if (profile.keys[i].channel === key.channel &&
                        String(profile.keys[i].address) === String(key.address)) {
                        saved = profile.keys[i]; break;
                    }
                }
                return saved ? Object.assign({}, key, { zmk: saved.zmk || '', display: saved.display || '' }) : key;
            });
            renderGrid();
            showProfileBanner('known', profile.name);
            sendKeymapOverSerial(profile.name);
        } else {
            showProfileBanner('new', '');
        }
    }

    function showProfileBanner(state, name) {
        var banner     = document.getElementById('cfgProfileBanner');
        var nameEl     = document.getElementById('cfgProfileName');
        var dotEl      = document.getElementById('cfgProfileDot');
        var saveBtn    = document.getElementById('cfgProfileSaveBtn');
        var renameBtn  = document.getElementById('cfgProfileRenameBtn');
        var updateBtn  = document.getElementById('cfgProfileUpdateBtn');
        var input      = document.getElementById('cfgProfileInput');
        var confirmBtn = document.getElementById('cfgProfileConfirmBtn');
        var cancelBtn  = document.getElementById('cfgProfileCancelBtn');
        if (!banner) return;

        banner.classList.remove('cfg-step--hidden');
        input.classList.add('cfg-step--hidden');
        confirmBtn.classList.add('cfg-step--hidden');
        cancelBtn.classList.add('cfg-step--hidden');

        if (state === 'known') {
            nameEl.textContent = name;
            dotEl.className    = 'cfg-profile-dot cfg-profile-dot--saved';
            saveBtn.classList.add('cfg-step--hidden');
            renameBtn.classList.remove('cfg-step--hidden');
            updateBtn.classList.remove('cfg-step--hidden');
            banner.classList.remove('cfg-profile-banner--new');
        } else {
            nameEl.textContent = 'New layout detected';
            dotEl.className    = 'cfg-profile-dot cfg-profile-dot--new';
            saveBtn.classList.remove('cfg-step--hidden');
            renameBtn.classList.add('cfg-step--hidden');
            updateBtn.classList.add('cfg-step--hidden');
            banner.classList.add('cfg-profile-banner--new');
        }
    }

    function beginProfileNameEdit() {
        var input      = document.getElementById('cfgProfileInput');
        var confirmBtn = document.getElementById('cfgProfileConfirmBtn');
        var cancelBtn  = document.getElementById('cfgProfileCancelBtn');
        var saveBtn    = document.getElementById('cfgProfileSaveBtn');
        var renameBtn  = document.getElementById('cfgProfileRenameBtn');
        var updateBtn  = document.getElementById('cfgProfileUpdateBtn');
        var profiles   = loadProfiles();
        var profile    = profiles[cfgCurrentFingerprint];

        input.value = profile ? profile.name : '';
        input.classList.remove('cfg-step--hidden');
        confirmBtn.classList.remove('cfg-step--hidden');
        cancelBtn.classList.remove('cfg-step--hidden');
        saveBtn.classList.add('cfg-step--hidden');
        renameBtn.classList.add('cfg-step--hidden');
        updateBtn.classList.add('cfg-step--hidden');
        input.focus();
        input.select();
    }

    function saveCurrentProfile(name) {
        if (!cfgCurrentFingerprint || !name.trim()) return;
        var profiles = loadProfiles();
        profiles[cfgCurrentFingerprint] = {
            name:    name.trim(),
            keys:    cfgKeys.map(function(k) {
                return { channel: k.channel, address: k.address, zmk: k.zmk || '', display: k.display || '' };
            }),
            savedAt: Date.now()
        };
        saveProfiles(profiles);
        showProfileBanner('known', name.trim());
    }

    function sendKeymapOverSerial(profileName) {
        pushKeymapOverSerial();
    }

    var ZMK_MOD_BITS = {
        LC: 0x01, LS: 0x02, LA: 0x04, LG: 0x08,
        RC: 0x10, RS: 0x20, RA: 0x40, RG: 0x80
    };

    var ZMK_TO_HID = {
        A:0x04, B:0x05, C:0x06, D:0x07, E:0x08, F:0x09, G:0x0A, H:0x0B,
        I:0x0C, J:0x0D, K:0x0E, L:0x0F, M:0x10, N:0x11, O:0x12, P:0x13,
        Q:0x14, R:0x15, S:0x16, T:0x17, U:0x18, V:0x19, W:0x1A, X:0x1B,
        Y:0x1C, Z:0x1D,
        N1:0x1E, N2:0x1F, N3:0x20, N4:0x21, N5:0x22,
        N6:0x23, N7:0x24, N8:0x25, N9:0x26, N0:0x27,
        RET:0x28, ENTER:0x28, ESC:0x29, BSPC:0x2A, TAB:0x2B, SPACE:0x2C,
        MINUS:0x2D, EQUAL:0x2E, LBKT:0x2F, RBKT:0x30, BSLH:0x31,
        SEMI:0x33, SQT:0x34, GRAVE:0x35, COMMA:0x36, DOT:0x37, SLASH:0x38,
        CAPS:0x39,
        F1:0x3A, F2:0x3B, F3:0x3C, F4:0x3D, F5:0x3E, F6:0x3F,
        F7:0x40, F8:0x41, F9:0x42, F10:0x43, F11:0x44, F12:0x45,
        F13:0x68, F14:0x69, F15:0x6A, F16:0x6B, F17:0x6C, F18:0x6D,
        F19:0x6E, F20:0x6F, F21:0x70, F22:0x71, F23:0x72, F24:0x73,
        PRINTSCREEN:0x46, SCROLLLOCK:0x47, PAUSE_BREAK:0x48,
        INS:0x49, HOME:0x4A, PG_UP:0x4B, DEL:0x4C, END:0x4D, PG_DN:0x4E,
        RIGHT:0x4F, LEFT:0x50, DOWN:0x51, UP:0x52
    };

    function zmkToHid(zmk) {
        if (!zmk || zmk === 'NONE' || zmk === '&none' || zmk === '') return null;
        var mod = 0;
        var str = zmk.trim().replace(/^&kp\s+/, '');
        var modPattern = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/;
        var match;
        while ((match = str.match(modPattern))) {
            mod |= ZMK_MOD_BITS[match[1]] || 0;
            str = match[2];
        }
        var usage = ZMK_TO_HID[str];
        if (!usage) return null;
        return { mod: mod, usage: usage };
    }

    function keyToSlot(channel, address) {
        var offset = parseInt(address, 16) - 0x20;
        var ch = parseInt(channel, 10);
        if (ch <= 3) return ch * 4 + offset;
        if (ch === 4) return 16 + offset;
        if (ch === 5) return 18 + offset;
        return -1;
    }

    function pushKeymapOverSerial() {
        if (!cfgSerialPort || !cfgSerialPort.writable) return;
        var btn = document.getElementById('cfgPushBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }

        var commands = [];
        cfgKeys.forEach(function(key) {
            var slot = keyToSlot(key.channel, key.address);
            if (slot < 0 || slot >= 20) return;
            var hid = zmkToHid(key.zmk || '');
            var modHex   = hid ? hid.mod.toString(16).padStart(2, '0')   : '00';
            var usageHex = hid ? hid.usage.toString(16).padStart(2, '0') : '00';
            commands.push('SK:KEY:' + slot + ':' + modHex + ':' + usageHex + '\n');
        });

        if (!commands.length) {
            if (btn) { btn.disabled = false; }
            return;
        }

        var writer = cfgSerialPort.writable.getWriter();
        writer.write(new TextEncoder().encode(commands.join('')))
            .then(function() {
                writer.releaseLock();
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '✓ Pushed';
                    setTimeout(function() { btn.textContent = 'Push to Device'; }, 2000);
                }
            })
            .catch(function() {
                try { writer.releaseLock(); } catch(e2) {}
                if (btn) { btn.disabled = false; btn.textContent = 'Push failed — retry'; }
            });
    }

    // ────────────────────────────────────────────────────────────────────────

    function renderGrid() {
        var grid = document.getElementById('cfgGrid');
        grid.innerHTML = '';

        // Update key count on hub
        var countEl = document.getElementById('cfgHubCount');
        if (countEl) countEl.textContent = cfgKeys.length + (cfgKeys.length === 1 ? ' key' : ' keys');

        if (cfgKeys.length === 0) {
            // Clear cables and pads
            var cablesEl = document.getElementById('cfgHubCables');
            if (cablesEl) cablesEl.innerHTML = '';
            var padsEl = document.getElementById('cfgHubPads');
            if (padsEl) padsEl.innerHTML = '';
            return;
        }

        var keySize = window.innerWidth <= 600 ? 72 : 88;
        var gapSize = window.innerWidth <= 600 ? 8 : 10;

        // Determine if we have any manually mapped positions (x,y from Layout Mapper)
        var mappedKeys = cfgKeys.filter(function(k) { return k.x !== undefined && k.y !== undefined; });
        var useXY = mappedKeys.length > 0;

        var numCols, minCh, maxCh, minRow, channels;

        if (useXY) {
            // Use x,y positions — only show keys that have been placed
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            mappedKeys.forEach(function(k) {
                if (k.x < minX) minX = k.x; if (k.x > maxX) maxX = k.x;
                if (k.y < minY) minY = k.y; if (k.y > maxY) maxY = k.y;
            });
            numCols = maxX - minX + 1;

            // For hub/cables, fall back to channel-based layout
            minCh = Infinity; maxCh = -Infinity;
            cfgKeys.forEach(function(k) {
                var ch = k.channel !== undefined ? k.channel : 0;
                if (ch < minCh) minCh = ch; if (ch > maxCh) maxCh = ch;
            });
        } else {
            // Determine grid bounds: channel → column, address offset → row
            minCh = Infinity; maxCh = -Infinity;
            var minRow = Infinity, maxRow = -Infinity;
            cfgKeys.forEach(function(key) {
                var ch = key.channel !== undefined ? key.channel : 0;
                var addr = parseInt(key.address, 16);
                var row = isNaN(addr) ? 0 : addr - 0x20;
                if (ch < minCh) minCh = ch; if (ch > maxCh) maxCh = ch;
                if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
            });
            numCols = maxCh - minCh + 1;
        }

        var gridWidth = numCols * keySize + (numCols - 1) * gapSize;

        // Size the hub-wrap and cables to match grid width so they all center together
        var hubWrap = document.getElementById('cfgHubWrap');
        if (hubWrap) hubWrap.style.width = gridWidth + 'px';
        var cablesEl = document.getElementById('cfgHubCables');
        if (cablesEl) cablesEl.style.width = gridWidth + 'px';

        // Collect unique channels sorted
        channels = [];
        var chSeen = {};
        cfgKeys.forEach(function(k) {
            var ch = k.channel !== undefined ? k.channel : 0;
            if (!chSeen[ch]) { chSeen[ch] = true; channels.push(ch); }
        });
        channels.sort(function(a, b) { return a - b; });

        // Position hub pads to align with their column centers
        var hubLeft = (gridWidth - 176) / 2;
        var padsEl = document.getElementById('cfgHubPads');
        if (padsEl) {
            padsEl.innerHTML = '';
            channels.forEach(function(ch) {
                var colIndex = ch - minCh;
                var colCenterInGrid = colIndex * (keySize + gapSize) + keySize / 2;
                var padCenterInHub = colCenterInGrid - hubLeft;

                var pad = document.createElement('div');
                pad.className = 'cfg-hub-pad cfg-hub-pad--active';
                pad.title = 'Channel ' + ch;
                pad.style.left = (padCenterInHub - 9) + 'px';
                padsEl.appendChild(pad);
            });
        }

        // Render channel cables connecting hub to key grid
        if (cablesEl) {
            cablesEl.innerHTML = '';
            channels.forEach(function(ch) {
                var colIndex = ch - minCh;
                var colCenterInGrid = colIndex * (keySize + gapSize) + keySize / 2;
                var line = document.createElement('div');
                line.className = 'cfg-cable-line';
                line.style.left = (colCenterInGrid - 0.75) + 'px';
                cablesEl.appendChild(line);
            });
        }

        // Render the key grid
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(' + numCols + ', ' + keySize + 'px)';

        if (useXY) {
            // Mapped layout: place keys at their physical x,y positions
            var minXV = Infinity, minYV = Infinity, maxYV = -Infinity;
            mappedKeys.forEach(function(k) {
                if (k.x < minXV) minXV = k.x;
                if (k.y < minYV) minYV = k.y;
                if (k.y > maxYV) maxYV = k.y;
            });
            var numRows = maxYV - minYV + 1;
            grid.style.gridTemplateRows = 'repeat(' + numRows + ', ' + keySize + 'px)';

            cfgKeys.forEach(function(key, i) {
                if (key.x === undefined || key.y === undefined) return;
                var col = key.x - minXV + 1;
                var row = key.y - minYV + 1;
                var sq = document.createElement('div');
                var isActive = (i === cfgActiveKey);
                sq.className = 'cfg-key'
                    + (key.zmk ? ' cfg-key--set' : '')
                    + (isActive ? ' cfg-key--active' : '');
                sq.dataset.index = i;
                sq.style.gridColumn = col;
                sq.style.gridRow = row;
                applyKeyColor(sq, key, isActive);
                if (key.zmk) {
                    sq.innerHTML = '<span class="cfg-key-num">K' + (i + 1) + '</span>'
                                 + '<span class="cfg-key-label">' + escHtml(key.display) + '</span>';
                } else {
                    sq.innerHTML = '<span class="cfg-key-num">K' + (i + 1) + '</span>'
                                 + '<span class="cfg-key-empty">—</span>';
                }
                sq.addEventListener('click', (function(idx) {
                    return function() { selectKey(idx); };
                })(i));
                grid.appendChild(sq);
            });
            return;
        }

        cfgKeys.forEach(function(key, i) {
            var ch = key.channel !== undefined ? key.channel : 0;
            var addr = parseInt(key.address, 16);
            var addrOffset = isNaN(addr) ? 0 : addr - 0x20;

            var col = ch - minCh + 1;
            var row = addrOffset - minRow + 1;

            var sq = document.createElement('div');
            var isActive = (i === cfgActiveKey);
            sq.className = 'cfg-key'
                + (key.zmk ? ' cfg-key--set' : '')
                + (isActive ? ' cfg-key--active' : '');
            sq.dataset.index = i;
            sq.style.gridColumn = col;
            sq.style.gridRow = row;
            applyKeyColor(sq, key, isActive);

            if (key.zmk) {
                sq.innerHTML = '<span class="cfg-key-num">K' + (i + 1) + '</span>'
                             + '<span class="cfg-key-label">' + escHtml(key.display) + '</span>';
            } else {
                sq.innerHTML = '<span class="cfg-key-num">K' + (i + 1) + '</span>'
                             + '<span class="cfg-key-empty">—</span>';
            }
            sq.addEventListener('click', (function(idx) {
                return function() { selectKey(idx); };
            })(i));
            grid.appendChild(sq);
        });
    }

    function renderHub() {
        var countEl = document.getElementById('cfgHubCount');
        if (countEl) countEl.textContent = cfgKeys.length + (cfgKeys.length === 1 ? ' key' : ' keys');
    }

    // ── Layout Mapper ─────────────────────────────────────────────────────────
    var KMAP_HUB_COL = 0;
    var KMAP_HUB_ROW = 0;
    var KMAP_HUB_W   = 2;
    var KMAP_HUB_H   = 2;

    var KMAP_FLAT_IDS = ['cfgHubWrap', 'cfgHubCables', 'cfgGrid'];

    function openMapper() {
        cfgMapperOpen = true;
        kmapPendingPos = null;
        // Seed Layout 1 from cfgKey positions only on first open
        if (kmapLayouts[0].keys.length === 0) {
            cfgKeys.forEach(function(key) {
                if (key.x !== undefined && key.y !== undefined) {
                    kmapLayouts[0].keys.push({ x: key.x, y: key.y, channel: key.channel, address: key.address });
                }
            });
        }
        kmapKeys = kmapLayouts[kmapActiveLayoutIdx].keys.slice();
        // Hide flat grid elements, show kmap
        KMAP_FLAT_IDS.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('cfg-step--hidden');
        });
        var hdr = document.querySelector('.cfg-layout-header');
        if (hdr) hdr.classList.add('cfg-step--hidden');
        document.getElementById('cfgMapper').classList.remove('cfg-step--hidden');
        var mapHeader = document.querySelector('.cfg-mapper-header');
        if (mapHeader) mapHeader.classList.remove('cfg-step--hidden');
        var cancelBtn = document.getElementById('kmapPopupCancel');
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        document.getElementById('kmapPopupCancel').addEventListener('click', kmapCancelPending);
        var skipBtn = document.getElementById('kmapPopupSkip');
        skipBtn.replaceWith(skipBtn.cloneNode(true));
        document.getElementById('kmapPopupSkip').addEventListener('click', kmapSkipPending);
        var gridWrap = document.getElementById('kmapGridWrap');
        if (gridWrap) gridWrap.classList.remove('kmap-grid-wrap--view');
        renderMapperLayouts();
        kmapRender();
    }

    function closeMapper() {
        cfgMapperOpen = false;
        kmapCancelPending();
        // Hide only the mapper header — keep the kmap grid as the main view
        var mapHeader = document.querySelector('.cfg-mapper-header');
        if (mapHeader) mapHeader.classList.add('cfg-step--hidden');
        var gridWrap = document.getElementById('kmapGridWrap');
        if (gridWrap) gridWrap.classList.add('kmap-grid-wrap--view');
        kmapRender(); // re-render without [+]s and without minus buttons
    }

    function kmapIsHubCell(x, y) {
        return x >= KMAP_HUB_COL && x < KMAP_HUB_COL + KMAP_HUB_W &&
               y >= KMAP_HUB_ROW && y < KMAP_HUB_ROW + KMAP_HUB_H;
    }

    function kmapIsBlocked(x, y) {
        if (!kmapBlockAboveHub) return false;
        return x >= KMAP_HUB_COL && x < KMAP_HUB_COL + KMAP_HUB_W && y < KMAP_HUB_ROW;
    }

    function kmapIsOccupied(x, y) {
        if (kmapIsHubCell(x, y)) return true;
        return kmapKeys.some(function(k) { return k.x === x && k.y === y; });
    }

    function kmapGetPlaceholders() {
        var phs = [], seen = {};
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        var occupied = [];
        for (var hx = KMAP_HUB_COL; hx < KMAP_HUB_COL + KMAP_HUB_W; hx++) {
            for (var hy = KMAP_HUB_ROW; hy < KMAP_HUB_ROW + KMAP_HUB_H; hy++) {
                occupied.push({ x: hx, y: hy });
            }
        }
        kmapKeys.forEach(function(k) { occupied.push({ x: k.x, y: k.y }); });
        occupied.forEach(function(cell) {
            dirs.forEach(function(d) {
                var nx = cell.x + d[0], ny = cell.y + d[1];
                var key = nx + ',' + ny;
                if (!seen[key] && !kmapIsOccupied(nx, ny) && !kmapIsBlocked(nx, ny)) {
                    seen[key] = true;
                    phs.push({ x: nx, y: ny });
                }
            });
        });
        return phs;
    }

    function kmapClickAdd(x, y) {
        kmapPendingPos = { x: x, y: y };
        var popup   = document.getElementById('kmapPopup');
        var msg     = document.getElementById('kmapPopupMsg');
        var skipBtn = document.getElementById('kmapPopupSkip');
        if (popup) popup.classList.remove('cfg-step--hidden');
        if (skipBtn) skipBtn.style.display = cfgIsDemo ? '' : 'none';
        if (msg) {
            msg.textContent = cfgIsDemo
                ? 'Click a key tile in the list that belongs here, or continue without.'
                : 'Press the physical key that belongs in this position, or cancel.';
        }
    }

    function kmapCancelPending() {
        kmapPendingPos = null;
        var popup = document.getElementById('kmapPopup');
        if (popup) popup.classList.add('cfg-step--hidden');
    }

    function kmapSkipPending() {
        if (kmapPendingPos === null) return;
        var x = kmapPendingPos.x, y = kmapPendingPos.y;
        // Create a demo-only placeholder key with a unique fake identity
        var demoId = 'demo_' + Date.now();
        cfgKeys.push({ channel: 'demo', address: demoId, zmk: '', display: 'Key', x: x, y: y });
        kmapPlaceKey(x, y, 'demo', demoId);
        kmapCancelPending();
    }

    function kmapPlaceKey(x, y, channel, address) {
        kmapKeys = kmapKeys.filter(function(k) {
            return !(k.channel === channel && String(k.address) === String(address));
        });
        kmapKeys.push({ x: x, y: y, channel: channel, address: address });
        kmapLayouts[kmapActiveLayoutIdx].keys = kmapKeys;
        kmapRender();
    }

    function kmapSwitchLayout(idx) {
        kmapLayouts[kmapActiveLayoutIdx].keys = kmapKeys; // save current
        kmapActiveLayoutIdx = idx;
        kmapKeys = kmapLayouts[kmapActiveLayoutIdx].keys.slice();
        renderMapperLayouts();
        kmapRender();
    }

    function kmapAddLayout() {
        kmapLayoutCount++;
        kmapLayouts.push({ id: kmapLayoutCount - 1, name: 'Layout ' + kmapLayoutCount, keys: [] });
        kmapSwitchLayout(kmapLayouts.length - 1);
    }

    function kmapDeleteLayout(idx) {
        if (kmapLayouts.length <= 1) return;
        kmapLayouts.splice(idx, 1);
        var newIdx = Math.min(idx, kmapLayouts.length - 1);
        kmapActiveLayoutIdx = newIdx;
        kmapKeys = kmapLayouts[newIdx].keys.slice();
        renderMapperLayouts();
        kmapRender();
    }

    function renderMapperLayouts() {
        var bar = document.getElementById('cfgMapperLayoutsBar');
        if (!bar) return;
        bar.innerHTML = '';
        kmapLayouts.forEach(function(layout, idx) {
            var isActive = (idx === kmapActiveLayoutIdx);
            if (isActive) {
                var group = document.createElement('div');
                group.className = 'kmap-layout-group';
                var badgeRow = document.createElement('div');
                badgeRow.className = 'kmap-layout-badge-row';
                var badge = document.createElement('button');
                badge.className = 'kmap-layout-badge kmap-layout-badge--active';
                badge.textContent = layout.name;
                var ctrlCol = document.createElement('div');
                ctrlCol.className = 'kmap-layout-ctrls';
                var renameBtn = document.createElement('button');
                renameBtn.className = 'kmap-layout-ctrl';
                renameBtn.title = 'Rename';
                renameBtn.textContent = 'Rename';
                renameBtn.addEventListener('click', function() {
                    badge.style.display = 'none';
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'kmap-layout-badge kmap-layout-badge--active';
                    input.value = layout.name;
                    input.maxLength = 20;
                    badgeRow.insertBefore(input, ctrlCol);
                    input.focus(); input.select();
                    function save() {
                        kmapLayouts[idx].name = input.value.trim() || layout.name;
                        renderMapperLayouts();
                    }
                    input.addEventListener('blur', save);
                    input.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') { e.preventDefault(); save(); }
                        if (e.key === 'Escape') { renderMapperLayouts(); }
                    });
                });
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'kmap-layout-ctrl kmap-layout-ctrl--del';
                deleteBtn.title = 'Delete layout';
                deleteBtn.textContent = 'Delete';
                if (kmapLayouts.length <= 1) deleteBtn.disabled = true;
                deleteBtn.addEventListener('click', function() { kmapDeleteLayout(idx); });
                ctrlCol.appendChild(renameBtn);
                ctrlCol.appendChild(deleteBtn);
                badgeRow.appendChild(badge);
                badgeRow.appendChild(ctrlCol);
                group.appendChild(badgeRow);
                bar.appendChild(group);
            } else {
                var badge = document.createElement('button');
                badge.className = 'kmap-layout-badge';
                badge.textContent = layout.name;
                (function(i) {
                    badge.addEventListener('click', function() { kmapSwitchLayout(i); });
                })(idx);
                bar.appendChild(badge);
            }
        });
        var addBtn = document.createElement('button');
        addBtn.className = 'kmap-layout-add';
        addBtn.textContent = '+';
        addBtn.title = 'Add layout';
        addBtn.addEventListener('click', kmapAddLayout);
        bar.appendChild(addBtn);
    }

    function kmapRender() {
        var grid = document.getElementById('kmapGrid');
        var wrap = document.getElementById('kmapGridWrap');
        if (!grid || !wrap) return;

        var phs = kmapGetPlaceholders();

        // Bounding box
        var allX = [], allY = [];
        for (var hx = KMAP_HUB_COL; hx < KMAP_HUB_COL + KMAP_HUB_W; hx++) allX.push(hx);
        for (var hy = KMAP_HUB_ROW; hy < KMAP_HUB_ROW + KMAP_HUB_H; hy++) allY.push(hy);
        kmapKeys.forEach(function(k) { allX.push(k.x); allY.push(k.y); });
        phs.forEach(function(p)   { allX.push(p.x); allY.push(p.y); });

        var minX = Math.min.apply(null, allX), maxX = Math.max.apply(null, allX);
        var minY = Math.min.apply(null, allY), maxY = Math.max.apply(null, allY);
        var cols = maxX - minX + 1, rows = maxY - minY + 1;

        // Cell size that fits the wrap
        var pad = 56;
        var wrapW = wrap.clientWidth  || 560;
        var wrapH = wrap.clientHeight || 400;
        var cellSize = Math.max(32, Math.min(60,
            Math.floor((wrapW - pad) / cols),
            Math.floor((wrapH - pad) / rows)));
        var gap = Math.max(4, Math.round(cellSize * 0.1));

        function toCol(x) { return x - minX + 1; }
        function toRow(y) { return y - minY + 1; }

        grid.innerHTML = '';
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cellSize + 'px)';
        grid.style.gridTemplateRows    = 'repeat(' + rows + ', ' + cellSize + 'px)';
        grid.style.gap = gap + 'px';

        // Hub
        var hub = document.createElement('div');
        hub.className = 'kmap-hub';
        hub.style.gridColumn = toCol(KMAP_HUB_COL) + ' / span ' + KMAP_HUB_W;
        hub.style.gridRow    = toRow(KMAP_HUB_ROW) + ' / span ' + KMAP_HUB_H;
        hub.innerHTML = '<div class="kmap-hub-chip" id="kmapHubChip"></div><span class="kmap-hub-name">MacroHub</span>';
        grid.appendChild(hub);

        // Cable zone label (spanning hub width at the blocked row just above hub if visible)
        if (kmapBlockAboveHub && minY < KMAP_HUB_ROW) {
            var cableEl = document.createElement('div');
            cableEl.className = 'kmap-cable';
            cableEl.style.gridColumn = toCol(KMAP_HUB_COL) + ' / span ' + KMAP_HUB_W;
            cableEl.style.gridRow    = toRow(KMAP_HUB_ROW - 1);
            cableEl.innerHTML = '<span class="kmap-cable-label">⚡ cable</span>';
            grid.appendChild(cableEl);
        }

        // Placed keys
        kmapKeys.forEach(function(k) {
            var cfgKey = null;
            for (var i = 0; i < cfgKeys.length; i++) {
                if (cfgKeys[i].channel === k.channel && String(cfgKeys[i].address) === String(k.address)) {
                    cfgKey = cfgKeys[i]; break;
                }
            }
            var isSet = cfgKey && cfgKey.zmk;
            var kmapKeyIdx = -1;
            for (var ki = 0; ki < cfgKeys.length; ki++) {
                if (cfgKeys[ki].channel === k.channel && String(cfgKeys[ki].address) === String(k.address)) { kmapKeyIdx = ki; break; }
            }
            var isKmapActive = (kmapKeyIdx !== -1 && kmapKeyIdx === cfgActiveKey);
            var colorId = cfgKey && cfgKey.color || 'default';
            var colorDef = PREFS_COLORS.filter(function(c) { return c.id === colorId; })[0] || PREFS_COLORS[0];
            var cell = document.createElement('div');
            cell.className = 'kmap-key' + (isSet ? '' : ' kmap-key--unset') + (isKmapActive ? ' kmap-key--active' : '');
            cell.dataset.channel = k.channel;
            cell.dataset.address = String(k.address);
            cell.style.gridColumn = toCol(k.x);
            cell.style.gridRow    = toRow(k.y);
            applyKeyColor(cell, cfgKey || {}, isKmapActive);
            var lbl    = cfgKey && cfgKey.display ? cfgKey.display : 'Key';
            var symbol = cfgKey && cfgKey.symbol  ? cfgKey.symbol  : '';
            var zmkLbl = cfgKey && cfgKey.zmk     ? cfgKey.zmk     : '';
            cell.innerHTML = (cfgMapperOpen ? '<span class="kmap-key-minus">−</span>' : '')
                + '<span class="kmap-key-lbl">' + escHtml(lbl) + '</span>'
                + (symbol ? '<span class="kmap-key-symbol">' + escHtml(symbol) + '</span>' : '')
                + (zmkLbl ? '<span class="kmap-key-zmk">'    + escHtml(zmkLbl) + '</span>' : '');
            (function(kk) {
                if (cfgMapperOpen) {
                    var minusEl = cell.querySelector('.kmap-key-minus');
                    if (minusEl) minusEl.addEventListener('click', function(e) {
                        e.stopPropagation();
                        kmapKeys = kmapKeys.filter(function(m) { return !(m.channel === kk.channel && String(m.address) === String(kk.address)); });
                        kmapLayouts[kmapActiveLayoutIdx].keys = kmapKeys;
                        kmapRender();
                    });
                }
                // Click body always selects key for shortcut assignment
                cell.addEventListener('click', function() {
                    for (var i = 0; i < cfgKeys.length; i++) {
                        if (cfgKeys[i].channel === kk.channel && String(cfgKeys[i].address) === String(kk.address)) {
                            selectKey(i);
                            return;
                        }
                    }
                });
            })(k);
            grid.appendChild(cell);
        });

        // [+] placeholders only in edit mode
        if (cfgMapperOpen) {
            phs.forEach(function(p) {
                var cell = document.createElement('div');
                cell.className = 'kmap-add';
                cell.style.gridColumn = toCol(p.x);
                cell.style.gridRow    = toRow(p.y);
                cell.innerHTML = '<span class="kmap-add-plus">+</span>';
                (function(px, py) {
                    cell.addEventListener('click', function() { kmapClickAdd(px, py); });
                })(p.x, p.y);
                grid.appendChild(cell);
            });
        }
    }

    function findActionIcon(zmk) {
        return '';
    }

    function selectKey(index) {
        // In demo mode with mapper open and a [+] selected, assign that key to the pending position
        if (cfgMapperOpen && cfgIsDemo && kmapPendingPos !== null) {
            var key = cfgKeys[index];
            if (key) {
                kmapPlaceKey(kmapPendingPos.x, kmapPendingPos.y, key.channel, key.address);
                kmapCancelPending();
            }
            return;
        }
        cfgActiveKey = index;
        cfgEditIndex = index;
        renderGrid();
        if (cfgMapperOpen) kmapRender();
        document.getElementById('cfgPicker').classList.remove('cfg-step--hidden');
        showPickerPane(cfgActivePaneId);
    }

    function showPickerPane(paneId) {
        if (paneId) cfgActivePaneId = paneId;
        var panes = ['cfgPaneKeyboard', 'cfgPaneSpecial', 'cfgPanePrefs', 'cfgPaneLayer', 'cfgPaneBluetooth', 'cfgPaneSeq'];
        panes.forEach(function(id) {
            document.getElementById(id).classList.toggle('cfg-step--hidden', id !== paneId);
        });
        document.querySelectorAll('.cfg-cat-tab[data-pane]').forEach(function(tab) {
            tab.classList.toggle('cfg-cat-tab--active', tab.dataset.pane === paneId);
        });
        if      (paneId === 'cfgPaneKeyboard')  { renderKbGrid(cfgActivePaneBadge); }
        else if (paneId === 'cfgPaneSpecial')   { renderSpecialGrid(); }
        else if (paneId === 'cfgPanePrefs')     { renderPrefsPane(); }
        else if (paneId === 'cfgPaneLayer')     { renderLayerList(); }
        else if (paneId === 'cfgPaneBluetooth') { renderBtPane(); }
        else if (paneId === 'cfgPaneSeq')       { cfgSeqSteps = []; renderSeqSteps(); }
    }

    var PREFS_COLORS = [
        { id: 'default', label: 'Blue',   border: 'rgba(115,144,185,0.5)',  bg: 'rgba(115,144,185,0.08)', swatch: '#7390b9', active: '#5b9cf6' },
        { id: 'teal',    label: 'Teal',   border: 'rgba(72,184,172,0.55)',  bg: 'rgba(72,184,172,0.07)',  swatch: '#48b8ac', active: '#3ecfbf' },
        { id: 'green',   label: 'Green',  border: 'rgba(90,180,100,0.55)',  bg: 'rgba(90,180,100,0.07)',  swatch: '#5ab464', active: '#5ed96a' },
        { id: 'yellow',  label: 'Yellow', border: 'rgba(210,175,60,0.6)',   bg: 'rgba(210,175,60,0.07)',  swatch: '#d2af3c', active: '#f0c83a' },
        { id: 'orange',  label: 'Orange', border: 'rgba(210,130,55,0.6)',   bg: 'rgba(210,130,55,0.07)',  swatch: '#d2823a', active: '#f09040' },
        { id: 'red',     label: 'Red',    border: 'rgba(200,80,80,0.55)',   bg: 'rgba(200,80,80,0.07)',   swatch: '#c85050', active: '#f05858' },
        { id: 'pink',    label: 'Pink',   border: 'rgba(195,100,175,0.55)', bg: 'rgba(195,100,175,0.07)', swatch: '#c364af', active: '#e870d0' },
        { id: 'purple',  label: 'Purple', border: 'rgba(140,100,210,0.55)', bg: 'rgba(140,100,210,0.07)', swatch: '#8c64d2', active: '#a070f0' },
        { id: 'gray',    label: 'Gray',   border: 'rgba(130,138,150,0.45)', bg: 'rgba(130,138,150,0.06)', swatch: '#828a96', active: '#9aa2ae' }
    ];

    function getKeyColorStyles(colorId, isActive) {
        var c = PREFS_COLORS.filter(function(x) { return x.id === colorId; })[0] || PREFS_COLORS[0];
        var hex = isActive ? (c.active || c.swatch) : c.swatch;
        var r = parseInt(hex.slice(1,3), 16);
        var g = parseInt(hex.slice(3,5), 16);
        var b = parseInt(hex.slice(5,7), 16);
        var rgb = r + ',' + g + ',' + b;
        if (isActive) {
            return {
                borderColor: 'rgba(' + rgb + ',0.95)',
                boxShadow:   '0 0 0 3px rgba(' + rgb + ',0.4), 0 0 18px rgba(' + rgb + ',0.2)',
                background:  'rgba(' + rgb + ',0.18)'
            };
        }
        return {
            borderColor: 'rgba(' + rgb + ',0.68)',
            background:  'rgba(' + rgb + ',0.14)'
        };
    }

    function applyKeyColor(el, key, isActive) {
        if (isActive) {
            var s = getKeyColorStyles(key.color || 'default', true);
            el.style.borderColor = s.borderColor;
            el.style.boxShadow   = s.boxShadow;
            el.style.background  = s.background;
            el.style.transform   = 'translateY(-2px)';
        } else if (key.color && key.color !== 'default') {
            var s = getKeyColorStyles(key.color, false);
            el.style.borderColor = s.borderColor;
            el.style.background  = s.background;
        }
    }

    var cfgPrefsSelectedColor = 'default';

    function renderPrefsPane() {
        var key = cfgKeys[cfgActiveKey];
        if (!key) return;
        var nameIn   = document.getElementById('cfgPrefsName');
        var symbolIn = document.getElementById('cfgPrefsSymbol');
        nameIn.value   = key.display || '';
        symbolIn.value = key.symbol  || '';
        cfgPrefsSelectedColor = key.color || 'default';

        // Live-update on text input
        nameIn.oninput = function() {
            var k = cfgKeys[cfgActiveKey]; if (!k) return;
            k.display = nameIn.value.trim() || 'Key';
            renderGrid(); kmapRender();
        };
        symbolIn.oninput = function() {
            var k = cfgKeys[cfgActiveKey]; if (!k) return;
            k.symbol = symbolIn.value.trim();
            renderGrid(); kmapRender();
        };

        // Color swatches
        var wrap = document.getElementById('cfgPrefsSwatches');
        wrap.innerHTML = '';
        PREFS_COLORS.forEach(function(c) {
            var btn = document.createElement('button');
            btn.className = 'cfg-prefs-swatch' + (c.id === cfgPrefsSelectedColor ? ' cfg-prefs-swatch--active' : '');
            btn.title = c.label;
            btn.style.background = c.swatch;
            btn.addEventListener('click', function() {
                cfgPrefsSelectedColor = c.id;
                wrap.querySelectorAll('.cfg-prefs-swatch').forEach(function(s) { s.classList.remove('cfg-prefs-swatch--active'); });
                btn.classList.add('cfg-prefs-swatch--active');
                var k = cfgKeys[cfgActiveKey]; if (!k) return;
                k.color = c.id;
                renderGrid(); kmapRender();
            });
            wrap.appendChild(btn);
        });
    }

    function renderBtPane() {
        var list = document.getElementById('cfgBtList');
        list.innerHTML = '';
        for (var i = 0; i < 5; i++) {
            var item = document.createElement('div');
            item.className = 'cfg-bt-item';
            item.innerHTML = '<span class="cfg-bt-num">' + (i + 1) + '</span>'
                           + '<span class="cfg-bt-label">Device ' + (i + 1) + '</span>';
            item.addEventListener('click', (function(idx) {
                return function() { assignBt(idx); };
            })(i));
            list.appendChild(item);
        }
    }

    function showPageTab(tabId) {
        var isConf = tabId === 'configure';
        document.getElementById('cfgViewConfigure').classList.toggle('cfg-step--hidden', !isConf);
        document.getElementById('cfgViewBlockBuilder').classList.toggle('cfg-step--hidden', isConf);
        document.getElementById('cfgTabBlockBuilderBtn').classList.toggle('cfg-cat-tab--active', !isConf);
        document.getElementById('cfgTabBlockBuilderBtn').classList.toggle('cfg-cat-tab--bb--active', !isConf);
        if (!isConf) {
            renderBBKeyGrid();
            if (cfgActiveKey >= 0) {
                bbSelectKey(cfgActiveKey);
            }
            renderBBCanvas();
            bbSyncKeyDots();
            bbValidate();
        }
    }

    function renderKbGrid(badge) {
        cfgActivePaneBadge = badge;
        document.querySelectorAll('.cfg-badge').forEach(function(b) {
            b.classList.toggle('cfg-badge--active', b.dataset.badge === badge);
        });
        var keys = badge === 'letters' ? KB_LETTERS
                 : badge === 'numbers' ? KB_NUMBERS
                 : KB_OTHER;
        var grid = document.getElementById('cfgKbGrid');
        grid.innerHTML = '';
        keys.forEach(function(key) {
            var btn = document.createElement('button');
            btn.className = 'cfg-kb-key'
                + (key.mod   ? ' cfg-kb-key--mod'   : '')
                + (key.wide  ? ' cfg-kb-key--wide'  : '')
                + (key.wider ? ' cfg-kb-key--wider' : '');
            if (key.mod && cfgComboMods.indexOf(key.zmk) >= 0) btn.classList.add('active-mod');
            btn.textContent = key.display;
            btn.addEventListener('click', (function(k) {
                return function() { comboAddKey(k); };
            })(key));
            grid.appendChild(btn);
        });
    }

    function renderSpecialGrid() {
        // Badge bar
        var badgeBar = document.getElementById('cfgSpecialBadges');
        badgeBar.innerHTML = '';
        ['media', 'launch', 'system', 'text'].forEach(function(cat) {
            var btn = document.createElement('button');
            btn.className = 'cfg-badge' + (cat === cfgSpecialBadge ? ' cfg-badge--active' : '');
            btn.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
            btn.addEventListener('click', function() {
                cfgSpecialBadge = cat;
                renderSpecialGrid();
            });
            badgeBar.appendChild(btn);
        });
        // Filtered actions
        var grid = document.getElementById('cfgPickerGrid');
        grid.innerHTML = '';
        CFG_SPECIAL.filter(function(a) { return a.cat === cfgSpecialBadge; }).forEach(function(action) {
            var btn = document.createElement('button');
            btn.className = 'cfg-action-item';
            btn.innerHTML = '<span class="cfg-action-label">' + escHtml(action.display) + '</span>';
            btn.addEventListener('click', (function(a) {
                return function() { assignAction(a); };
            })(action));
            grid.appendChild(btn);
        });
        var clearBtn = document.createElement('button');
        clearBtn.className = 'cfg-action-item cfg-action-item--clear';
        clearBtn.innerHTML = '<span class="cfg-action-label">Clear</span>';
        clearBtn.addEventListener('click', clearActiveKey);
        grid.appendChild(clearBtn);
    }

    // ── Combo builder ─────────────────────────────────────────────────────────
    function comboAddKey(key) {
        if (key.mod) {
            var idx = cfgComboMods.indexOf(key.zmk);
            if (idx >= 0) cfgComboMods.splice(idx, 1);
            else cfgComboMods.push(key.zmk);
            updateComboDisplay();
            renderKbGrid(cfgActivePaneBadge);
        } else {
            cfgComboBase = key;
            updateComboDisplay();
        }
    }

    function updateComboDisplay() {
        var chips = document.getElementById('cfgComboChips');
        var assignBtn = document.getElementById('cfgComboAssign');
        if (!chips) return;
        if (cfgComboMods.length === 0 && !cfgComboBase) {
            chips.innerHTML = '<span class="cfg-combo-placeholder">Press a key or select below</span>';
            if (assignBtn) assignBtn.disabled = true;
            return;
        }
        chips.innerHTML = '';
        cfgComboMods.forEach(function(mod, mi) {
            var chip = document.createElement('span');
            chip.className = 'cfg-combo-chip cfg-combo-chip--mod';
            var found = null;
            for (var i = 0; i < KB_OTHER.length; i++) { if (KB_OTHER[i].zmk === mod) { found = KB_OTHER[i]; break; } }
            chip.textContent = found ? found.display : mod;
            chips.appendChild(chip);
            var plus = document.createElement('span');
            plus.className = 'cfg-combo-plus';
            plus.textContent = '+';
            chips.appendChild(plus);
        });
        if (cfgComboBase) {
            var chip = document.createElement('span');
            chip.className = 'cfg-combo-chip';
            chip.textContent = cfgComboBase.display;
            chips.appendChild(chip);
        }
        if (assignBtn) assignBtn.disabled = !cfgComboBase;
    }

    function buildComboZmk() {
        if (!cfgComboBase) return '';
        var zmk = cfgComboBase.zmk;
        cfgComboMods.slice().reverse().forEach(function(mod) {
            var prefix = ZMK_MOD_MAP[mod];
            if (prefix) zmk = prefix + '(' + zmk + ')';
        });
        return zmk;
    }

    function buildComboDisplay() {
        var parts = [];
        cfgComboMods.forEach(function(mod) {
            var found = null;
            for (var i = 0; i < KB_OTHER.length; i++) { if (KB_OTHER[i].zmk === mod) { found = KB_OTHER[i]; break; } }
            parts.push(found ? found.display : mod);
        });
        if (cfgComboBase) parts.push(cfgComboBase.display);
        return parts.join('+');
    }

    function assignCombo() {
        if (!cfgComboBase || cfgActiveKey < 0) return;
        var idx = cfgActiveKey;
        cfgKeys[idx].zmk     = buildComboZmk();
        cfgKeys[idx].display = buildComboDisplay();
        clearCombo();
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    function clearCombo() {
        cfgComboMods = [];
        cfgComboBase = null;
        updateComboDisplay();
        renderKbGrid(cfgActivePaneBadge);
    }

    function onKbPhysicalKey(e) {
        var kbPane = document.getElementById('cfgPaneKeyboard');
        if (!kbPane || kbPane.classList.contains('cfg-step--hidden')) return;
        if (!document.getElementById('cfgModal').classList.contains('cfg-step--hidden')) return;
        var modKeyNames = ['Control','Shift','Alt','Meta','CapsLock','NumLock','ScrollLock'];
        if (modKeyNames.indexOf(e.key) >= 0) {
            var modMap = { Control: e.location === 2 ? 'RCTRL' : 'LCTRL',
                           Shift:   e.location === 2 ? 'RSHFT' : 'LSHFT',
                           Alt:     e.location === 2 ? 'RALT'  : 'LALT',
                           Meta:    e.location === 2 ? 'RGUI'  : 'LGUI' };
            if (modMap[e.key]) {
                e.preventDefault();
                var idx = cfgComboMods.indexOf(modMap[e.key]);
                if (idx >= 0) cfgComboMods.splice(idx, 1);
                else cfgComboMods.push(modMap[e.key]);
                updateComboDisplay();
                renderKbGrid(cfgActivePaneBadge);
            }
            return;
        }
        e.preventDefault();
        cfgComboBase = eventToZmkBase(e);
        updateComboDisplay();
    }

    function eventToZmkBase(e) {
        var SP = {
            ' ':           { zmk: 'SPACE',   display: 'Space' },
            'Enter':       { zmk: 'RET',     display: 'Enter' },
            'Escape':      { zmk: 'ESC',     display: 'Esc' },
            'Backspace':   { zmk: 'BSPC',    display: 'Bspc' },
            'Tab':         { zmk: 'TAB',     display: 'Tab' },
            'Delete':      { zmk: 'DEL',     display: 'Del' },
            'ArrowLeft':   { zmk: 'LEFT',    display: 'Left' },
            'ArrowRight':  { zmk: 'RIGHT',   display: 'Right' },
            'ArrowUp':     { zmk: 'UP',      display: 'Up' },
            'ArrowDown':   { zmk: 'DOWN',    display: 'Down' },
            'Home':        { zmk: 'HOME',    display: 'Home' },
            'End':         { zmk: 'END',     display: 'End' },
            'PageUp':      { zmk: 'PG_UP',   display: 'PgUp' },
            'PageDown':    { zmk: 'PG_DN',   display: 'PgDn' },
            'Insert':      { zmk: 'INS',     display: 'Ins' },
        };
        for (var fi = 1; fi <= 24; fi++) SP['F' + fi] = { zmk: 'F' + fi, display: 'F' + fi };
        var sp = SP[e.key];
        if (sp) return sp;
        if (e.key.length === 1) return { zmk: e.key.toUpperCase(), display: e.key.toUpperCase() };
        return { zmk: e.key.toUpperCase(), display: e.key };
    }

    // ── Layer pane ────────────────────────────────────────────────────────────
    function openLayerModal() { showPickerPane('cfgPaneLayer'); }

    function renderLayerList() {
        var list = document.getElementById('cfgLayerList');
        list.innerHTML = '';
        cfgLayers.forEach(function(layer) {
            var item = document.createElement('div');
            item.className = 'cfg-layer-item' + (layer.id === cfgSelectedLayer ? ' cfg-layer-item--active' : '');
            item.innerHTML = '<span class="cfg-layer-badge">' + layer.id + '</span>'
                           + '<span class="cfg-layer-name">' + escHtml(layer.name) + '</span>';
            item.addEventListener('click', (function(l) {
                return function() { cfgSelectedLayer = l.id; renderLayerList(); };
            })(layer));
            list.appendChild(item);
        });
    }

    function addLayer() {
        if (cfgLayers.length >= 20) return;
        var id = cfgLayerCount++;
        cfgLayers.push({ id: id, name: 'Layer ' + id });
        cfgSelectedLayer = id;
        renderLayerList();
    }

    function deleteLayer() {
        if (cfgSelectedLayer === 0) return; // can't delete default
        var layer = null;
        for (var i = 0; i < cfgLayers.length; i++) { if (cfgLayers[i].id === cfgSelectedLayer) { layer = cfgLayers[i]; break; } }
        if (!layer) return;
        document.getElementById('cfgConfirmMsg').textContent = 'Delete "' + layer.name + '"?';
        document.getElementById('cfgConfirmModal').classList.remove('cfg-step--hidden');
    }

    function confirmDeleteLayer() {
        cfgLayers = cfgLayers.filter(function(l) { return l.id !== cfgSelectedLayer; });
        cfgSelectedLayer = cfgLayers.length > 0 ? cfgLayers[0].id : 0;
        document.getElementById('cfgConfirmModal').classList.add('cfg-step--hidden');
        renderLayerList();
    }

    function assignLayer() {
        if (cfgActiveKey < 0) return;
        var idx = cfgActiveKey;
        cfgKeys[idx].zmk     = 'TO(' + cfgSelectedLayer + ')';
        cfgKeys[idx].display = 'Layer ' + cfgSelectedLayer;
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    // ── Bluetooth pane ────────────────────────────────────────────────────────
    function assignBt(profileIdx) {
        if (cfgActiveKey < 0) return;
        var idx = cfgActiveKey;
        cfgKeys[idx].zmk     = 'BT_SEL(' + profileIdx + ')';
        cfgKeys[idx].display = 'BT ' + (profileIdx + 1);
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    // ── Sequence pane ─────────────────────────────────────────────────────────
    function openSeqModal() { showPickerPane('cfgPaneSeq'); }

    function renderSeqSteps() {
        var container = document.getElementById('cfgSeqSteps');
        if (cfgSeqSteps.length === 0) {
            container.innerHTML = '<p class="cfg-seq-empty">Press "Add Step" to add your first action</p>';
            return;
        }
        container.innerHTML = '';
        cfgSeqSteps.forEach(function(step, i) {
            var div = document.createElement('div');
            div.className = 'cfg-seq-step';
            var sel = document.createElement('select');
            sel.className = 'cfg-seq-select';
            [['keyboard','Key'],['special','Special'],['bt','BT'],['layer','Layer']].forEach(function(o) {
                var opt = document.createElement('option');
                opt.value = o[0]; opt.textContent = o[1];
                if (o[0] === step.type) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', (function(idx) {
                return function() {
                    cfgSeqSteps[idx].type = sel.value;
                    cfgSeqSteps[idx].value = '';
                    renderSeqSteps();
                };
            })(i));
            div.appendChild(sel);
            var valIn = document.createElement('input');
            valIn.type = 'text'; valIn.className = 'cfg-seq-value';
            valIn.placeholder = step.type === 'layer' ? 'Layer 0-19' : 'ZMK or display';
            valIn.value = step.value || '';
            valIn.addEventListener('input', (function(idx) {
                return function() { cfgSeqSteps[idx].value = valIn.value; cfgSeqSteps[idx].display = valIn.value; };
            })(i));
            div.appendChild(valIn);
            var row = document.createElement('div');
            row.className = 'cfg-seq-delay-row';
            var lbl = document.createElement('span'); lbl.className = 'cfg-seq-delay-label'; lbl.textContent = 'wait';
            var delIn = document.createElement('input');
            delIn.type = 'number'; delIn.className = 'cfg-seq-delay';
            delIn.min = 0; delIn.max = 60000; delIn.value = step.delay || 100;
            delIn.addEventListener('input', (function(idx) {
                return function() { cfgSeqSteps[idx].delay = parseInt(delIn.value) || 100; };
            })(i));
            var unit = document.createElement('span'); unit.className = 'cfg-seq-delay-unit'; unit.textContent = 'ms';
            row.appendChild(lbl); row.appendChild(delIn); row.appendChild(unit);
            div.appendChild(row);
            container.appendChild(div);
        });
    }

    function addSeqStep() {
        cfgSeqSteps.push({ type: 'keyboard', value: '', display: '', delay: 100 });
        renderSeqSteps();
    }

    function assignSeq() {
        if (cfgActiveKey < 0 || cfgSeqSteps.length === 0) return;
        var idx = cfgActiveKey;
        cfgKeys[idx].zmk     = 'SEQ';
        cfgKeys[idx].display = 'Seq(' + cfgSeqSteps.length + ')';
        cfgKeys[idx].seq     = cfgSeqSteps.slice();
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    function assignAction(action) {
        if (cfgActiveKey < 0) return;
        var idx = cfgActiveKey;
        cfgKeys[idx].zmk     = action.zmk;
        cfgKeys[idx].display = action.display;
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    function clearActiveKey() {
        if (cfgActiveKey < 0) return;
        cfgKeys[cfgActiveKey].zmk     = '';
        cfgKeys[cfgActiveKey].display = '';
        cfgActiveKey = -1;
        renderGrid();
        if (cfgMapperOpen) kmapRender();
        document.getElementById('cfgPicker').classList.add('cfg-step--hidden');
    }

    function flashAssignLine(keyIndex) {
        var key = cfgKeys[keyIndex];
        if (!key) return;
        var wrap = document.getElementById('kmapGridWrap');
        var chipEl = document.getElementById('kmapHubChip');
        if (!wrap || !chipEl) return;
        // Find the kmap-key cell for this key
        var keyEl = null;
        wrap.querySelectorAll('.kmap-key').forEach(function(cell) {
            if (cell.dataset.channel == key.channel && cell.dataset.address == String(key.address)) {
                keyEl = cell;
            }
        });
        if (!keyEl) return;

        var wrapRect = wrap.getBoundingClientRect();
        var chipRect = chipEl.getBoundingClientRect();
        var keyRect  = keyEl.getBoundingClientRect();

        var hx = chipRect.left + chipRect.width  / 2 - wrapRect.left;
        var hy = chipRect.top  + chipRect.height / 2 - wrapRect.top;
        var kx = keyRect.left  + keyRect.width   / 2 - wrapRect.left;
        var ky = keyRect.top   + keyRect.height  / 2 - wrapRect.top;

        // Snap the hub Y to the nearest key-cell row center so the horizontal
        // segment travels through the middle of keys, not through the gap
        // (the hub spans 2 rows so its chip center falls between row centers).
        var allKeyRects = Array.prototype.slice.call(wrap.querySelectorAll('.kmap-key'));
        var snapY = allKeyRects.reduce(function(best, cell) {
            var r = cell.getBoundingClientRect();
            var cy = r.top + r.height / 2 - wrapRect.top;
            return Math.abs(cy - hy) < Math.abs(best - hy) ? cy : best;
        }, hy);
        // Similarly snap hub X to nearest key-cell column center
        var snapX = allKeyRects.reduce(function(best, cell) {
            var r = cell.getBoundingClientRect();
            var cx = r.left + r.width / 2 - wrapRect.left;
            return Math.abs(cx - hx) < Math.abs(best - hx) ? cx : best;
        }, hx);

        // Reuse or create SVG overlay
        var svg = wrap.querySelector('.kmap-assign-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'kmap-assign-svg');
            svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:10';
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            wrap.appendChild(svg);
        }
        // Cancel any running fade-out timer
        if (svg._fadeTimer) { clearTimeout(svg._fadeTimer); svg._fadeTimer = null; }
        svg.style.opacity = '1';
        svg.style.transition = '';
        svg.innerHTML = '';

        // 3-point Manhattan: hub chip → snap to nearest key row (tiny jog) →
        // horizontal through key row to target column → vertical to target key
        var pts = hx + ',' + hy + ' ' + snapX + ',' + snapY + ' ' + kx + ',' + snapY + ' ' + kx + ',' + ky;
        var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        pl.setAttribute('points', pts);
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', '#5b9cf6');
        pl.setAttribute('stroke-width', '2.5');
        pl.setAttribute('stroke-linecap', 'round');
        pl.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(pl);

        // Total pixel length of the 3-segment path
        var totalLen = Math.abs(snapX - hx) + Math.abs(snapY - hy)   // hub → snap
                     + Math.abs(kx - snapX)                           // horizontal
                     + Math.abs(ky - snapY);                          // vertical
        if (totalLen < 1) return;

        // Duration scales with distance: 300px ≈ 0.5s
        var duration = Math.max(0.3, totalLen / 600);

        pl.style.strokeDasharray  = totalLen;
        pl.style.strokeDashoffset = totalLen;
        // Double rAF ensures the browser registers the initial dashoffset before transitioning
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                pl.style.transition = 'stroke-dashoffset ' + duration + 's linear';
                pl.style.strokeDashoffset = '0';
            });
        });

        // Fade the line out shortly after it finishes
        svg._fadeTimer = setTimeout(function() {
            svg.style.transition = 'opacity 0.4s ease';
            svg.style.opacity = '0';
            svg._fadeTimer = setTimeout(function() { svg.innerHTML = ''; svg.style.opacity = '1'; svg.style.transition = ''; }, 400);
        }, duration * 1000 + 150);
    }

    function openCustomModal() {
        cfgPending = null;
        document.getElementById('cfgModalDisplay').textContent = '—';
        document.getElementById('cfgModalZmk').textContent = '';
        document.getElementById('cfgModalSave').disabled = true;
        document.getElementById('cfgModal').classList.remove('cfg-step--hidden');
        document.getElementById('cfgModal').focus();
    }

    function escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function openModal(index) {
        cfgEditIndex = index;
        cfgPending   = null;
        document.getElementById('cfgModalDisplay').textContent = '—';
        document.getElementById('cfgModalZmk').textContent = '';
        document.getElementById('cfgModalSave').disabled = true;
        document.getElementById('cfgModal').classList.remove('cfg-step--hidden');
        document.getElementById('cfgModal').focus();
    }

    function closeModal() {
        cfgEditIndex = -1;
        cfgPending   = null;
        document.getElementById('cfgModal').classList.add('cfg-step--hidden');
    }

    function saveModal() {
        if (!cfgPending) return;
        var idx = cfgEditIndex;
        cfgKeys[idx].zmk     = cfgPending.zmk;
        cfgKeys[idx].display = cfgPending.display;
        closeModal();
        renderGrid();
        if (cfgMapperOpen) { kmapRender(); flashAssignLine(idx); }
    }

    function onModalKey(e) {
        if (document.getElementById('cfgModal').classList.contains('cfg-step--hidden')) return;
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault();
        var result = eventToZmk(e);
        cfgPending = result;
        document.getElementById('cfgModalDisplay').textContent = result.display;
        document.getElementById('cfgModalZmk').textContent = 'ZMK: ' + result.zmk;
        document.getElementById('cfgModalSave').disabled = false;
    }

    function eventToZmk(e) {
        var SPECIAL = {
            ' ': { z: 'SPACE', d: 'Space' },
            'Enter': { z: 'ENTER', d: 'Enter' },
            'Escape': { z: 'ESC', d: 'Esc' },
            'Backspace': { z: 'BSPC', d: 'Backspace' },
            'Tab': { z: 'TAB', d: 'Tab' },
            'Delete': { z: 'DEL', d: 'Delete' },
            'ArrowLeft': { z: 'LEFT', d: '←' },
            'ArrowRight': { z: 'RIGHT', d: '→' },
            'ArrowUp': { z: 'UP', d: '↑' },
            'ArrowDown': { z: 'DOWN', d: '↓' },
            'Home': { z: 'HOME', d: 'Home' },
            'End': { z: 'END', d: 'End' },
            'PageUp': { z: 'PG_UP', d: 'Page Up' },
            'PageDown': { z: 'PG_DN', d: 'Page Down' },
            'Insert': { z: 'INS', d: 'Insert' },
            'F1': { z: 'F1', d: 'F1' }, 'F2': { z: 'F2', d: 'F2' },
            'F3': { z: 'F3', d: 'F3' }, 'F4': { z: 'F4', d: 'F4' },
            'F5': { z: 'F5', d: 'F5' }, 'F6': { z: 'F6', d: 'F6' },
            'F7': { z: 'F7', d: 'F7' }, 'F8': { z: 'F8', d: 'F8' },
            'F9': { z: 'F9', d: 'F9' }, 'F10': { z: 'F10', d: 'F10' },
            'F11': { z: 'F11', d: 'F11' }, 'F12': { z: 'F12', d: 'F12' }
        };
        var sp = SPECIAL[e.key];
        var baseZmk  = sp ? sp.z : (e.key.length === 1 ? e.key.toUpperCase() : e.key.toUpperCase());
        var baseDisp = sp ? sp.d : (e.key.length === 1 ? e.key.toUpperCase() : e.key);

        var mods = [], labels = [];
        if (e.ctrlKey)  { mods.push('LC'); labels.push('Ctrl'); }
        if (e.altKey)   { mods.push('LA'); labels.push('Alt'); }
        if (e.metaKey)  { mods.push('LG'); labels.push('Win'); }
        if (e.shiftKey) { mods.push('LS'); labels.push('Shift'); }

        var zmk = baseZmk;
        for (var i = mods.length - 1; i >= 0; i--) zmk = mods[i] + '(' + zmk + ')';

        return { zmk: zmk, display: labels.concat([baseDisp]).join('+') };
    }

    function handleBuild() {
        // Sync current key assignments back to the saved profile before building
        var buildProfile = loadProfiles()[cfgCurrentFingerprint];
        if (buildProfile) {
            saveCurrentProfile(buildProfile.name);
            sendKeymapOverSerial(buildProfile.name);
        }
        cfgKeys.forEach(function (k) { if (!k.zmk) { k.zmk = 'NONE'; k.display = '(none)'; } });
        showCfgStep('cfgStepBuild');
        document.getElementById('cfgBuildMsg').textContent = 'Pushing files to GitHub...';
        document.getElementById('cfgSpinnerWrap').style.display = '';
        document.getElementById('cfgDownloadBtn').classList.add('cfg-step--hidden');
        document.getElementById('cfgRestartBtn').classList.add('cfg-step--hidden');

        if (CONFIGURE_BACKEND_URL === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') {
            document.getElementById('cfgBuildMsg').textContent =
                'Error: backend URL not set. Open script.js and paste your Apps Script URL.';
            document.getElementById('cfgSpinnerWrap').style.display = 'none';
            return;
        }

        saveSessionLayout();
        callBackend({ action: 'build', keys: cfgKeys })
            .then(function (res) {
                if (res.error) throw new Error(res.error);
                document.getElementById('cfgBuildMsg').textContent = 'Build queued. Waiting for GitHub...';
                return pollStatus(res.runId);
            })
            .catch(function (err) {
                document.getElementById('cfgBuildMsg').textContent = 'Error: ' + (err.message || err);
                document.getElementById('cfgSpinnerWrap').style.display = 'none';
            });
    }

    function pollStatus(runId) {
        var attempts = 0;
        var max = 30; // 30 × 10s = 5 min max
        function check() {
            return callBackend({ action: 'status', runId: runId }).then(function (res) {
                attempts++;
                if (res.status === 'completed') {
                    document.getElementById('cfgBuildMsg').textContent = 'Build complete!';
                    document.getElementById('cfgSpinnerWrap').style.display = 'none';
                    var dlBtn = document.getElementById('cfgDownloadBtn');
                    dlBtn.classList.remove('cfg-step--hidden');
                    dlBtn.addEventListener('click', function () { triggerDownload(runId); }, { once: true });
                    document.getElementById('cfgRestartBtn').classList.remove('cfg-step--hidden');
                    document.getElementById('cfgFlashSteps').classList.remove('cfg-step--hidden');
                    return;
                }
                if (res.status === 'failed') {
                    document.getElementById('cfgBuildMsg').textContent =
                        'Build failed. Check your GitHub Actions logs.';
                    document.getElementById('cfgSpinnerWrap').style.display = 'none';
                    document.getElementById('cfgRestartBtn').classList.remove('cfg-step--hidden');
                    return;
                }
                if (attempts >= max) {
                    document.getElementById('cfgBuildMsg').textContent =
                        'Timed out. Check GitHub Actions manually.';
                    document.getElementById('cfgSpinnerWrap').style.display = 'none';
                    return;
                }
                var label = res.status === 'in_progress' ? 'building' : (res.status || 'waiting');
                document.getElementById('cfgBuildMsg').textContent =
                    'Status: ' + label + '... (' + (attempts * 10) + 's)';
                return new Promise(function (resolve) { setTimeout(resolve, 10000); }).then(check);
            });
        }
        return check();
    }

    function triggerDownload(runId) {
        var btn = document.getElementById('cfgDownloadBtn');
        btn.textContent = 'Downloading...';
        callBackend({ action: 'download', runId: runId })
            .then(function (res) {
                if (res.error) throw new Error(res.error);
                var bytes = atob(res.data);
                var arr = new Uint8Array(bytes.length);
                for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
                var url = URL.createObjectURL(new Blob([arr], { type: 'application/octet-stream' }));
                var a = document.createElement('a');
                a.href = url; a.download = 'macro_hub.uf2';
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
                btn.textContent = 'Download again';
                btn.addEventListener('click', function () { triggerDownload(runId); }, { once: true });
            })
            .catch(function (err) {
                btn.textContent = 'Download failed — try again';
                btn.addEventListener('click', function () { triggerDownload(runId); }, { once: true });
            });
    }

    function callBackend(payload) {
        return fetch(CONFIGURE_BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });
    }

    // ── Session cloud save/restore ─────────────────────────────────────────────

    function saveSessionLayout() {
        if (!cfgSessionId || !cfgKeys.length) return;
        callBackend({ action: 'save_layout', session: cfgSessionId, keys: cfgKeys })
            .catch(function() {});
    }

    function checkSessionRestore() {
        if (!cfgSessionId) return;
        callBackend({ action: 'get_layout', session: cfgSessionId })
            .then(function(res) {
                if (!res.keys || res.keys.length === 0) return;
                var connectStep = document.getElementById('cfgStepConnect');
                if (!connectStep) return;
                var banner = document.createElement('div');
                banner.className = 'cfg-restore-banner';
                banner.innerHTML =
                    '<span class="cfg-restore-msg">Restore your last layout?</span>'
                    + '<button class="cfg-btn cfg-btn--sm" id="cfgRestoreYes">Restore</button>'
                    + '<button class="cfg-btn cfg-btn--secondary cfg-btn--sm" id="cfgRestoreNo">Dismiss</button>';
                connectStep.appendChild(banner);
                document.getElementById('cfgRestoreYes').addEventListener('click', function() {
                    cfgKeys = res.keys;
                    cfgIsDemo = true;
                    renderGrid();
                    showCfgStep('cfgStepAssign');
                    openMapper();
                    banner.remove();
                });
                document.getElementById('cfgRestoreNo').addEventListener('click', function() {
                    banner.remove();
                });
            })
            .catch(function() {});
    }

    // ── Popular bindings panel ─────────────────────────────────────────────────

    function renderStatsPanel() {
        var existing = document.getElementById('cfgStatsPanel');
        if (existing) existing.remove();

        callBackend({ action: 'get_stats' }).then(function(res) {
            if (!res.total || res.total < 5) return;

            var insights = [];
            cfgKeys.forEach(function(key, slot) {
                var slotData = res.slots && res.slots[slot];
                if (!slotData || !slotData.length) return;
                var top = slotData[0];
                if (!top || top.zmk === '&none' || top.zmk === 'NONE' || top.pct < 20) return;
                var display = top.zmk.replace(/^&kp\s+/, '');
                insights.push({ slot: slot, zmk: display, pct: top.pct });
            });
            if (!insights.length) return;

            var panel = document.createElement('div');
            panel.id = 'cfgStatsPanel';
            panel.className = 'cfg-stats-panel';

            var hdr = document.createElement('div');
            hdr.className = 'cfg-stats-header';
            hdr.textContent = 'Popular with ' + res.total + ' users';
            panel.appendChild(hdr);

            insights.slice(0, 6).forEach(function(item) {
                var row = document.createElement('div');
                row.className = 'cfg-stats-row';
                row.innerHTML =
                    '<span class="cfg-stats-slot">K' + (item.slot + 1) + '</span>'
                    + '<span class="cfg-stats-key">' + escHtml(item.zmk) + '</span>'
                    + '<span class="cfg-stats-pct">' + item.pct + '%</span>'
                    + '<button class="cfg-btn cfg-btn--secondary cfg-btn--sm">Use</button>';
                row.querySelector('button').addEventListener('click', (function(i) {
                    return function() {
                        cfgKeys[i.slot].zmk = i.zmk;
                        cfgKeys[i.slot].display = i.zmk;
                        renderGrid();
                    };
                })(item));
                panel.appendChild(row);
            });

            var actions = document.querySelector('.cfg-assign-actions');
            if (actions) actions.parentNode.insertBefore(panel, actions);
        }).catch(function() {});
    }

    // ── Community presets modal ────────────────────────────────────────────────

    function openPresetsModal() {
        var modal = document.getElementById('cfgPresetsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cfgPresetsModal';
            modal.className = 'cfg-modal';
            modal.innerHTML =
                '<div class="cfg-modal-box" style="max-width:520px;width:90%">'
                + '<p class="cfg-modal-title">Community Presets</p>'
                + '<div id="cfgPresetsList" style="max-height:340px;overflow-y:auto;margin-bottom:16px"></div>'
                + '<div class="cfg-modal-btns">'
                + '<button class="cfg-btn cfg-btn--secondary" id="cfgPresetsClose">Close</button>'
                + '</div></div>';
            document.getElementById('mainContent').appendChild(modal);
            document.getElementById('cfgPresetsClose').addEventListener('click', function() {
                modal.classList.add('cfg-step--hidden');
            });
            modal.addEventListener('click', function(e) {
                if (e.target === modal) modal.classList.add('cfg-step--hidden');
            });
        }
        modal.classList.remove('cfg-step--hidden');

        var list = document.getElementById('cfgPresetsList');
        list.innerHTML = '<p style="text-align:center;padding:16px">Loading…</p>';

        callBackend({ action: 'get_presets' }).then(function(res) {
            list.innerHTML = '';
            var presets = (res && res.presets) || [];
            if (!presets.length) {
                list.innerHTML = '<p class="cfg-hint" style="padding:16px">No community presets yet.</p>';
                return;
            }
            presets.forEach(function(preset) {
                var card = document.createElement('div');
                card.style.cssText = 'border:1px solid rgba(120,120,120,0.2);border-radius:8px;padding:10px 12px;margin-bottom:8px';

                var hdr = document.createElement('div');
                hdr.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-bottom:6px';
                hdr.innerHTML =
                    '<strong>' + escHtml(preset.name) + '</strong>'
                    + (preset.app ? '<span style="opacity:0.6;font-size:0.85em">' + escHtml(preset.app) + '</span>' : '')
                    + '<span class="preset-vote-count" style="margin-left:auto;font-size:0.85em">♥ ' + (preset.votes || 0) + '</span>';
                card.appendChild(hdr);

                var chips = document.createElement('div');
                chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px';
                var maxSlots = Math.min((cfgKeys.length || 20), preset.keys.length, 10);
                for (var i = 0; i < maxSlots; i++) {
                    var k = preset.keys[i];
                    var disp = k && k.zmk ? k.zmk.replace(/^&kp\s+/, '').replace(/^&none$/, '—') : '—';
                    var chip = document.createElement('span');
                    chip.style.cssText = 'background:rgba(120,120,120,0.1);border-radius:4px;padding:2px 6px;font-size:0.78em';
                    chip.textContent = 'K' + (i + 1) + ' ' + disp;
                    chips.appendChild(chip);
                }
                card.appendChild(chips);

                var btns = document.createElement('div');
                btns.style.cssText = 'display:flex;gap:6px';
                var loadBtn = document.createElement('button');
                loadBtn.className = 'cfg-btn cfg-btn--sm';
                loadBtn.textContent = 'Load preset';
                var voteBtn = document.createElement('button');
                voteBtn.className = 'cfg-btn cfg-btn--secondary cfg-btn--sm';
                voteBtn.textContent = '♥ Like';
                btns.appendChild(loadBtn);
                btns.appendChild(voteBtn);
                card.appendChild(btns);

                (function(p, lBtn, vBtn, vCount) {
                    lBtn.addEventListener('click', function() {
                        var max = Math.min(cfgKeys.length, p.keys.length);
                        for (var i = 0; i < max; i++) {
                            var kk = p.keys[i];
                            if (kk && kk.zmk && kk.zmk !== '&none' && kk.zmk !== 'NONE') {
                                var d = kk.zmk.replace(/^&kp\s+/, '');
                                cfgKeys[i].zmk = d;
                                cfgKeys[i].display = d;
                            }
                        }
                        renderGrid();
                        modal.classList.add('cfg-step--hidden');
                    });
                    vBtn.addEventListener('click', function() {
                        vBtn.disabled = true;
                        callBackend({ action: 'vote_preset', id: p.id })
                            .then(function(r) { vCount.textContent = '♥ ' + (r.votes || 0); })
                            .catch(function() { vBtn.disabled = false; });
                    });
                })(preset, loadBtn, voteBtn, card.querySelector('.preset-vote-count'));

                list.appendChild(card);
            });
        }).catch(function() {
            list.innerHTML = '<p class="cfg-hint" style="padding:16px">Could not load presets.</p>';
        });
    }

    // ── Block Builder ────────────────────────────────────────────────────────

    function bbScriptKey() {
        return bbActiveLyr + ':' + bbActiveKey;
    }

    function bbGetScript(layerId, keyIdx) {
        var k = layerId + ':' + keyIdx;
        if (!bbScripts[k]) bbScripts[k] = [];
        return bbScripts[k];
    }

    function initBlockBuilder() {
        renderBBLayerTabs();
        renderBBKeyGrid();
        renderBBPalette();
        renderBBCanvas();
        bbValidate();

        document.getElementById('bbLayerAddBtn').addEventListener('click', bbAddLayer);

        renderBBMiniKmap();

        var ddBtn = document.getElementById('bbKeyDdBtn');
        if (ddBtn) ddBtn.addEventListener('click', bbToggleDropdown);

        document.getElementById('bbBackBtn').addEventListener('click', function() {
            showPageTab('configure');
        });

        var recBtn  = document.getElementById('bbRecordBtn');
        var stopBtn = document.getElementById('bbRecordStop');
        if (recBtn)  recBtn.addEventListener('click', bbStartRecord);
        if (stopBtn) stopBtn.addEventListener('click', bbStopRecord);
    }

    // ── Macro recorder ────────────────────────────────────────────────────────

    var bbRecording      = false;
    var bbRecordedCombos = [];
    var bbRecordKeyFn    = null;

    function bbStartRecord() {
        if (bbRecording) return;
        if (bbActiveKey === null) {
            alert('Select a key first, then press Record.');
            return;
        }
        bbRecording      = true;
        bbRecordedCombos = [];

        var banner = document.getElementById('bbRecordBanner');
        var recBtn = document.getElementById('bbRecordBtn');
        var chips  = document.getElementById('bbRecordCombos');
        if (banner) banner.classList.add('bb-record-banner--active');
        if (recBtn) recBtn.classList.add('bb-record-btn--active');
        if (chips)  chips.innerHTML = '';

        bbRecordKeyFn = function(e) {
            if (['Control','Meta','Alt','Shift'].includes(e.key)) return;
            e.preventDefault();
            var parts = [];
            if (e.ctrlKey  || e.key === 'Control') parts.push('Ctrl');
            if (e.metaKey  || e.key === 'Meta')    parts.push('Meta');
            if (e.altKey   || e.key === 'Alt')     parts.push('Alt');
            if (e.shiftKey || e.key === 'Shift')   parts.push('Shift');
            var k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            parts.push(k);
            var combo = parts.join('+');
            bbRecordedCombos.push(combo);

            if (chips) {
                var chip = document.createElement('span');
                chip.className = 'bb-record-chip';
                chip.textContent = combo;
                chips.appendChild(chip);
            }
        };
        document.addEventListener('keydown', bbRecordKeyFn, true);
    }

    function bbStopRecord() {
        if (!bbRecording) return;
        bbRecording = false;
        document.removeEventListener('keydown', bbRecordKeyFn, true);
        bbRecordKeyFn = null;

        var banner = document.getElementById('bbRecordBanner');
        var recBtn = document.getElementById('bbRecordBtn');
        if (banner) banner.classList.remove('bb-record-banner--active');
        if (recBtn) recBtn.classList.remove('bb-record-btn--active');

        if (!bbRecordedCombos.length) return;

        var script = bbGetScript(bbActiveLyr, bbActiveKey);
        var hasHat = script.some(function(b) { return BB_BLOCKS[b.type] && BB_BLOCKS[b.type].hat; });
        if (!hasHat) {
            script.push(makeBlock('on_press'));
        }

        // Add all combo blocks with data set before any render
        bbRecordedCombos.forEach(function(combo) {
            var block = makeBlock('press_shortcut');
            block.data.combo = combo;
            script.push(block);
        });

        bbRecordedCombos = [];
        renderBBCanvas();
        bbSyncKeyDots();
        bbValidate();
    }

    function bbToggleDropdown() {
        var panel = document.getElementById('bbKeyDdPanel');
        var wrap  = document.getElementById('bbKeyDropdown');
        var open  = panel && panel.classList.contains('bb-key-dd-panel--open');
        if (open) {
            if (panel) panel.classList.remove('bb-key-dd-panel--open');
            if (wrap)  wrap.classList.remove('bb-key-dropdown--open');
        } else {
            if (panel) panel.classList.add('bb-key-dd-panel--open');
            if (wrap)  wrap.classList.add('bb-key-dropdown--open');
            renderBBMiniKmap();
        }
    }

    function bbCloseDropdown() {
        var panel = document.getElementById('bbKeyDdPanel');
        var wrap  = document.getElementById('bbKeyDropdown');
        if (panel) panel.classList.remove('bb-key-dd-panel--open');
        if (wrap)  wrap.classList.remove('bb-key-dropdown--open');
    }

    function renderBBMiniKmap() {
        var container = document.getElementById('bbMiniKmap');
        if (!container) return;

        if (!kmapLayouts || kmapActiveLayoutIdx === undefined) {
            container.innerHTML = '<p class="bb-key-empty" style="padding:10px 14px;margin:0">Map keys first</p>';
            return;
        }

        var layoutKeys = (kmapLayouts[kmapActiveLayoutIdx] || kmapLayouts[0] || {}).keys || [];

        if (layoutKeys.length === 0) {
            container.innerHTML = '<p class="bb-key-empty" style="padding:10px 14px;margin:0">Map keys first</p>';
            return;
        }

        var allX = [], allY = [];
        for (var hx = KMAP_HUB_COL; hx < KMAP_HUB_COL + KMAP_HUB_W; hx++) allX.push(hx);
        for (var hy = KMAP_HUB_ROW; hy < KMAP_HUB_ROW + KMAP_HUB_H; hy++) allY.push(hy);
        layoutKeys.forEach(function(k) { allX.push(k.x); allY.push(k.y); });

        var minX = Math.min.apply(null, allX), maxX = Math.max.apply(null, allX);
        var minY = Math.min.apply(null, allY), maxY = Math.max.apply(null, allY);
        var cols = maxX - minX + 1, rows = maxY - minY + 1;

        var cellSize = 28, gap = 3;

        function toCol(x) { return x - minX + 1; }
        function toRow(y) { return y - minY + 1; }

        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cellSize + 'px)';
        container.style.gridTemplateRows    = 'repeat(' + rows + ', ' + cellSize + 'px)';
        container.style.gap = gap + 'px';

        // Hub
        var hub = document.createElement('div');
        hub.className = 'bb-mini-hub';
        hub.style.gridColumn = toCol(KMAP_HUB_COL) + ' / span ' + KMAP_HUB_W;
        hub.style.gridRow    = toRow(KMAP_HUB_ROW) + ' / span ' + KMAP_HUB_H;
        container.appendChild(hub);

        // Placed keys
        layoutKeys.forEach(function(k) {
            var cfgIdx = -1, cfgKey = null;
            for (var i = 0; i < cfgKeys.length; i++) {
                if (cfgKeys[i].channel === k.channel && String(cfgKeys[i].address) === String(k.address)) {
                    cfgIdx = i; cfgKey = cfgKeys[i]; break;
                }
            }
            var isActive = (cfgIdx !== -1 && cfgIdx === bbActiveKey);
            var cell = document.createElement('div');
            cell.className = 'bb-mini-key' + (isActive ? ' bb-mini-key--active' : '');
            cell.style.gridColumn = toCol(k.x);
            cell.style.gridRow    = toRow(k.y);

            var numEl = document.createElement('span');
            numEl.className = 'bb-mini-key-num';
            numEl.textContent = cfgIdx >= 0 ? 'K' + (cfgIdx + 1) : '';
            cell.appendChild(numEl);

            var lblEl = document.createElement('span');
            lblEl.className = 'bb-mini-key-lbl';
            var display = cfgKey && cfgKey.display ? cfgKey.display
                        : cfgKey && cfgKey.zmk     ? cfgKey.zmk.replace(/&/g, '')
                        : '';
            lblEl.textContent = display;
            cell.appendChild(lblEl);

            if (cfgIdx >= 0) {
                (function(idx) {
                    cell.addEventListener('click', function() {
                        bbSelectKey(idx);
                        bbCloseDropdown();
                    });
                })(cfgIdx);
            }
            container.appendChild(cell);
        });
    }

    function bbSelectKey(idx) {
        bbActiveKey = idx;
        document.querySelectorAll('.bb-key-tile').forEach(function(t) {
            t.classList.toggle('bb-key-tile--active', +t.dataset.idx === idx);
        });
        // Update dropdown label
        var lbl = document.getElementById('bbKeyDdLbl');
        if (lbl) {
            var key = cfgKeys[idx];
            var name = key && key.display ? key.display
                     : key && key.zmk     ? key.zmk.replace(/&/g, '')
                     : '';
            lbl.textContent = 'K' + (idx + 1) + (name ? '  ·  ' + name : '');
        }
        renderBBMiniKmap();
        document.getElementById('bbCanvasHint').style.display = 'none';
        document.getElementById('bbCanvas').style.display = '';
        renderBBCanvas();
        bbValidate();
    }

    function bbSelectLayer(id) {
        bbActiveLyr = id;
        renderBBLayerTabs();
        renderBBCanvas();
        bbSyncKeyDots();
        bbValidate();
    }

    function bbAddLayer() {
        var id = bbLayerCount++;
        bbLayers.push({ id: id, name: 'Layer ' + (id + 1) });
        renderBBLayerTabs();
        bbSelectLayer(id);
    }

    function bbDk(hex, amt) {
        var n = parseInt(hex.slice(1), 16);
        var r  = Math.max(0, (n >> 16) - amt);
        var gg = Math.max(0, ((n >> 8) & 255) - amt);
        var b  = Math.max(0, (n & 255) - amt);
        return '#' + ((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0');
    }

    function bbSvgPathStack(w, h) {
        var nx = 14, nw = 15, nh = 4, r = 1;
        return 'M' + r + ' 0 L' + nx + ' 0 L' + nx + ' ' + (-nh) + ' L' + (nx+nw) + ' ' + (-nh) + ' L' + (nx+nw) + ' 0 L' + (w-r) + ' 0 Q' + w + ' 0 ' + w + ' ' + r + ' L' + w + ' ' + (h-r) + ' Q' + w + ' ' + h + ' ' + (w-r) + ' ' + h + ' L' + (nx+nw) + ' ' + h + ' L' + (nx+nw) + ' ' + (h+nh) + ' L' + nx + ' ' + (h+nh) + ' L' + nx + ' ' + h + ' L' + r + ' ' + h + ' Q0 ' + h + ' 0 ' + (h-r) + ' L0 ' + r + ' Q0 0 ' + r + ' 0 Z';
    }

    function bbSvgPathHat(w, h) {
        var nx = 14, nw = 15, nh = 4, r = 1;
        return 'M' + r + ' 0 Q' + (w*0.12) + ' ' + (-h*0.38) + ' ' + (w*0.5) + ' ' + (-h*0.34) + ' Q' + (w*0.88) + ' ' + (-h*0.28) + ' ' + w + ' ' + r + ' L' + w + ' ' + (h-r) + ' Q' + w + ' ' + h + ' ' + (w-r) + ' ' + h + ' L' + (nx+nw) + ' ' + h + ' L' + (nx+nw) + ' ' + (h+nh) + ' L' + nx + ' ' + (h+nh) + ' L' + nx + ' ' + h + ' L' + r + ' ' + h + ' Q0 ' + h + ' 0 ' + (h-r) + ' L0 ' + r + ' Q0 0 ' + r + ' 0 Z';
    }

    function bbCatColor(catId) {
        for (var i = 0; i < BB_CATS.length; i++) {
            if (BB_CATS[i].id === catId) return BB_CATS[i].color;
        }
        return '#555';
    }
    // ────────────────────────────────────────────────────────────

    function makeBlock(type) {
        var def = BB_BLOCKS[type];
        var data = {};
        (def.inputs || []).forEach(function(inp) {
            data[inp.key] = inp.default !== undefined ? inp.default : (inp.options ? inp.options[0] : '');
        });
        return { id: bbNextId++, type: type, data: data };
    }

    function bbAddBlock(type, insertAt) {
        if (bbActiveKey === null) return null;
        var script = bbGetScript(bbActiveLyr, bbActiveKey);
        var block = makeBlock(type);
        if (insertAt !== undefined && insertAt >= 0 && insertAt <= script.length) {
            script.splice(insertAt, 0, block);
        } else {
            script.push(block);
        }
        renderBBCanvas();
        bbSyncKeyDots();
        bbValidate();
        return block.id;
    }

    function bbRemoveBlock(blockId) {
        if (bbActiveKey === null) return;
        var script = bbGetScript(bbActiveLyr, bbActiveKey);
        var idx = script.findIndex(function(b) { return b.id === blockId; });
        if (idx !== -1) script.splice(idx, 1);
        renderBBCanvas();
        bbSyncKeyDots();
        bbValidate();
    }

    function bbMoveBlock(blockId, dir) {
        if (bbActiveKey === null) return;
        var script = bbGetScript(bbActiveLyr, bbActiveKey);
        var idx = script.findIndex(function(b) { return b.id === blockId; });
        if (idx === -1) return;
        var swap = idx + dir;
        if (swap < 0 || swap >= script.length) return;
        var tmp = script[idx]; script[idx] = script[swap]; script[swap] = tmp;
        renderBBCanvas();
        bbValidate();
    }

    function bbUpdateBlockData(blockId, key, value) {
        if (bbActiveKey === null) return;
        var script = bbGetScript(bbActiveLyr, bbActiveKey);
        var block = script.find(function(b) { return b.id === blockId; });
        if (block) { block.data[key] = value; bbValidate(); }
    }

    function bbValidate() {
        var indicator = document.getElementById('bbRunIndicator');
        var label     = document.getElementById('bbRunLabel');
        if (!indicator) return;

        var hasAny = false;
        var errors = [];

        Object.keys(bbScripts).forEach(function(k) {
            var script = bbScripts[k];
            if (!script || script.length === 0) return;
            hasAny = true;
            var parts = k.split(':');
            var lyr = +parts[0], ki = +parts[1];
            var hat = script[0] && BB_BLOCKS[script[0].type] && BB_BLOCKS[script[0].type].hat;
            if (!hat) errors.push('Key ' + (ki + 1) + ' (layer ' + (lyr + 1) + '): no trigger at top');
        });

        if (!hasAny) {
            indicator.className = 'bb-run-indicator';
            label.textContent = '—';
        } else if (errors.length === 0) {
            indicator.className = 'bb-run-indicator bb-run-indicator--valid';
            label.textContent = 'Valid';
        } else {
            indicator.className = 'bb-run-indicator bb-run-indicator--error';
            label.textContent = errors[0];
        }
    }

    function bbSyncKeyDots() {
        document.querySelectorAll('.bb-key-tile').forEach(function(tile) {
            var idx = +tile.dataset.idx;
            var dot = tile.querySelector('.bb-key-tile-dot');
            if (!dot) return;
            var hasScript = false;
            bbLayers.forEach(function(lyr) {
                var s = bbScripts[lyr.id + ':' + idx];
                if (s && s.length > 0) hasScript = true;
            });
            dot.style.background = hasScript ? '#44cc88' : 'transparent';
        });
    }

    function renderBBLayerTabs() {
        var wrap = document.getElementById('bbLayerTabs');
        if (!wrap) return;
        wrap.innerHTML = '';
        bbLayers.forEach(function(lyr) {
            var btn = document.createElement('button');
            btn.className = 'bb-layer-tab' + (lyr.id === bbActiveLyr ? ' bb-layer-tab--active' : '');
            btn.textContent = lyr.name;
            btn.dataset.id = lyr.id;
            btn.addEventListener('click', function() { bbSelectLayer(lyr.id); });
            btn.addEventListener('dblclick', function() { bbRenameLayer(lyr); });
            wrap.appendChild(btn);
        });
    }

    function bbRenameLayer(lyr) {
        var name = prompt('Rename layer:', lyr.name);
        if (name && name.trim()) {
            lyr.name = name.trim();
            renderBBLayerTabs();
        }
    }

    function renderBBKeyGrid() {
        var grid = document.getElementById('bbKeyGrid');
        if (!grid) return;
        if (!cfgKeys || cfgKeys.length === 0) {
            grid.innerHTML = '<p class="bb-key-empty">Connect keys first</p>';
            return;
        }
        grid.innerHTML = '';
        cfgKeys.forEach(function(key, idx) {
            var tile = document.createElement('div');
            tile.className = 'bb-key-tile' + (bbActiveKey === idx ? ' bb-key-tile--active' : '');
            tile.dataset.idx = idx;

            var dot = document.createElement('span');
            dot.className = 'bb-key-tile-dot';
            tile.appendChild(dot);

            var num = document.createElement('div');
            num.className = 'bb-key-tile-num';
            num.textContent = 'K' + (idx + 1);
            tile.appendChild(num);

            var lbl = document.createElement('div');
            lbl.className = 'bb-key-tile-lbl';
            lbl.textContent = key.display || (key.zmk ? key.zmk.replace(/&/g,'') : '—');
            tile.appendChild(lbl);

            tile.addEventListener('click', function() { bbSelectKey(idx); });
            grid.appendChild(tile);
        });
        bbSyncKeyDots();
    }

    function makePaletteBlockEl(type, def, cat) {
        var color = cat.color;
        var dark  = bbDk(color, 25);
        var pw = 112, ph = 24;
        var isHat = !!def.hat;
        var gy = isHat ? (Math.round(ph * 0.37) + 3) : 7;
        var svgH = gy + ph + 8;

        var wrap = document.createElement('div');
        wrap.className = 'bb-palette-block';
        wrap.dataset.type = type;
        wrap.style.cursor = 'grab';

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(pw + 4));
        svg.setAttribute('height', String(svgH));
        svg.style.overflow = 'visible';
        svg.style.display = 'block';
        svg.style.pointerEvents = 'none';

        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', 'translate(2,' + gy + ')');

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', isHat ? bbSvgPathHat(pw, ph) : bbSvgPathStack(pw, ph));
        path.setAttribute('fill', color);
        path.setAttribute('stroke', 'rgba(0,0,0,0.3)');
        path.setAttribute('stroke-width', '1');
        g.appendChild(path);

        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '10');
        text.setAttribute('y', String(ph / 2 + 4));
        text.setAttribute('fill', 'rgba(220,230,245,0.9)');
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', '500');
        text.setAttribute('font-family', "'Rubik', sans-serif");
        var labelText = def.label;
        if (labelText.length > 20) labelText = labelText.slice(0, 18) + '…';
        text.textContent = labelText;
        g.appendChild(text);

        svg.appendChild(g);
        wrap.appendChild(svg);

        wrap.addEventListener('mousedown', function(e) {
            bbStartPaletteDrag(e, type, cat.id, def.label, color);
        });

        return wrap;
    }

    function renderBBPalette() {
        var palette = document.getElementById('bbPalette');
        if (!palette) return;
        palette.innerHTML = '';

        BB_CATS.forEach(function(cat) {
            var hd = document.createElement('div');
            hd.className = 'bb-palette-cat-hd';
            hd.textContent = cat.label;
            hd.style.borderLeft = '2px solid ' + cat.color;
            hd.style.paddingLeft = '7px';
            hd.style.color = cat.color;
            palette.appendChild(hd);

            Object.keys(BB_BLOCKS).forEach(function(type) {
                var def = BB_BLOCKS[type];
                if (def.cat !== cat.id) return;
                palette.appendChild(makePaletteBlockEl(type, def, cat));
            });
        });
    }

    function renderBBCanvas() {
        var canvas  = document.getElementById('bbCanvas');
        var hint    = document.getElementById('bbCanvasHint');
        if (!canvas) return;

        if (bbActiveKey === null) {
            if (hint) hint.style.display = '';
            canvas.style.display = 'none';
            canvas.innerHTML = '';
            return;
        }
        if (hint) hint.style.display = 'none';
        canvas.style.display = '';
        canvas.innerHTML = '';

        var script = bbGetScript(bbActiveLyr, bbActiveKey);

        if (script.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'bb-canvas-hint';
            empty.textContent = 'Drag a Trigger block here to start';
            canvas.appendChild(empty);
            return;
        }

        script.forEach(function(block, idx) {
            var def = BB_BLOCKS[block.type];
            if (!def) return;
            canvas.appendChild(makeBlockEl(block, def, idx, script.length));
        });
    }

    function makeBlockEl(block, def, idx, total) {
        var color  = bbCatColor(def.cat);
        var dark   = bbDk(color, 30);
        var w      = 164;
        var h      = 36;
        var isHat  = !!def.hat;
        var ctrlW  = 48;
        var gy     = isHat ? (Math.round(h * 0.37) + 4) : 8;
        var svgH   = gy + h + 8;
        var mb     = -(svgH - h - gy + 8 - 4); // -12px

        var wrap = document.createElement('div');
        wrap.className = 'bb-block-svgwrap';
        wrap.dataset.id = block.id;
        wrap.style.marginBottom = mb + 'px';

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(w + 4));
        svg.setAttribute('height', String(svgH));
        svg.style.overflow = 'visible';
        svg.style.display = 'block';

        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', 'translate(2,' + gy + ')');

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', isHat ? bbSvgPathHat(w, h) : bbSvgPathStack(w, h));
        path.setAttribute('fill', color);
        path.setAttribute('stroke', 'rgba(0,0,0,0.35)');
        path.setAttribute('stroke-width', '1');
        g.appendChild(path);

        var innerW = w - ctrlW - 10;
        var fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('x', '8');
        fo.setAttribute('y', '0');
        fo.setAttribute('width', String(innerW));
        fo.setAttribute('height', String(h));

        var bodyDiv = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        bodyDiv.className = 'bb-block-body';

        var lbl = document.createElement('span');
        lbl.className = 'bb-block-label';
        lbl.textContent = def.label;
        bodyDiv.appendChild(lbl);

        (def.inputs || []).forEach(function(inp) {
            bodyDiv.appendChild(makeBBInput(inp, block));
        });

        fo.appendChild(bodyDiv);
        g.appendChild(fo);
        svg.appendChild(g);
        wrap.appendChild(svg);

        var ctrls = document.createElement('div');
        ctrls.className = 'bb-block-ctrls';
        ctrls.style.top = (gy + 8) + 'px';

        var upBtn = document.createElement('button');
        upBtn.className = 'bb-ctrl-btn';
        upBtn.textContent = '↑';
        upBtn.title = 'Move up';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', function() { bbMoveBlock(block.id, -1); });
        ctrls.appendChild(upBtn);

        var dnBtn = document.createElement('button');
        dnBtn.className = 'bb-ctrl-btn';
        dnBtn.textContent = '↓';
        dnBtn.title = 'Move down';
        dnBtn.disabled = idx === total - 1;
        dnBtn.addEventListener('click', function() { bbMoveBlock(block.id, 1); });
        ctrls.appendChild(dnBtn);

        var delBtn = document.createElement('button');
        delBtn.className = 'bb-ctrl-btn bb-ctrl-btn--del';
        delBtn.textContent = '×';
        delBtn.title = 'Remove';
        delBtn.addEventListener('click', function() { bbRemoveBlock(block.id); });
        ctrls.appendChild(delBtn);

        wrap.appendChild(ctrls);
        return wrap;
    }

    function makeBBInput(inp, block) {
        var val = block.data[inp.key];

        if (inp.type === 'num') {
            var wrap = document.createElement('span');
            var field = document.createElement('input');
            field.type = 'number';
            field.className = 'bb-input-num';
            field.value = val;
            field.addEventListener('change', function() {
                bbUpdateBlockData(block.id, inp.key, +field.value);
            });
            wrap.appendChild(field);
            if (inp.unit) {
                var unit = document.createElement('span');
                unit.className = 'bb-input-unit';
                unit.textContent = ' ' + inp.unit;
                wrap.appendChild(unit);
            }
            return wrap;
        }

        if (inp.type === 'text') {
            var field = document.createElement('input');
            field.type = 'text';
            field.className = 'bb-input-text';
            field.value = val;
            field.placeholder = inp.key;
            field.addEventListener('input', function() {
                bbUpdateBlockData(block.id, inp.key, field.value);
            });
            return field;
        }

        if (inp.type === 'select') {
            var sel = document.createElement('select');
            sel.className = 'bb-input-select';
            (inp.options || []).forEach(function(opt) {
                var o = document.createElement('option');
                o.value = opt; o.textContent = opt;
                if (opt === val) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', function() {
                bbUpdateBlockData(block.id, inp.key, sel.value);
            });
            return sel;
        }

        if (inp.type === 'layer_sel') {
            var sel = document.createElement('select');
            sel.className = 'bb-input-select';
            bbLayers.forEach(function(lyr) {
                var o = document.createElement('option');
                o.value = lyr.id; o.textContent = lyr.name;
                if (lyr.id === val) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', function() {
                bbUpdateBlockData(block.id, inp.key, +sel.value);
            });
            return sel;
        }

        if (inp.type === 'shortcut') {
            var btn = document.createElement('button');
            btn.className = 'bb-input-shortcut' + (val ? ' bb-input-shortcut--set' : '');
            btn.textContent = val || 'click to set…';
            btn.addEventListener('click', function() {
                btn.textContent = 'press keys…';
                btn.classList.add('bb-input-shortcut--rec');
                btn.classList.remove('bb-input-shortcut--set');
                function onKey(e) {
                    e.preventDefault();
                    var parts = [];
                    if (e.ctrlKey)  parts.push('Ctrl');
                    if (e.metaKey)  parts.push('Meta');
                    if (e.altKey)   parts.push('Alt');
                    if (e.shiftKey) parts.push('Shift');
                    var k = e.key;
                    if (!['Control','Meta','Alt','Shift'].includes(k)) parts.push(k);
                    if (parts.length === 0) return;
                    var combo = parts.join('+');
                    btn.textContent = combo;
                    btn.classList.remove('bb-input-shortcut--rec');
                    btn.classList.add('bb-input-shortcut--set');
                    bbUpdateBlockData(block.id, inp.key, combo);
                    document.removeEventListener('keydown', onKey, true);
                }
                document.addEventListener('keydown', onKey, true);
            });
            return btn;
        }

        var span = document.createElement('span');
        span.className = 'bb-block-label';
        span.textContent = String(val);
        return span;
    }

    // Drag-from-palette

    function bbStartPaletteDrag(e, type, catId, label, color) {
        e.preventDefault();
        bbDragType = type;

        bbGhost = document.createElement('div');
        bbGhost.className = 'bb-drag-ghost';
        bbGhost.style.setProperty('--ghost-color', color);
        var stripe = document.createElement('span');
        stripe.className = 'bb-palette-stripe';
        bbGhost.appendChild(stripe);
        bbGhost.appendChild(document.createTextNode(label));
        document.body.appendChild(bbGhost);

        function onMove(ev) {
            bbGhost.style.left = (ev.clientX + 12) + 'px';
            bbGhost.style.top  = (ev.clientY - 14) + 'px';
            updateDropIndicator(ev);
        }
        function onUp(ev) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (bbGhost) { bbGhost.remove(); bbGhost = null; }
            clearDropIndicators();
            var canvas = document.getElementById('bbCanvas');
            if (canvas && canvas.contains(ev.target) || isOverCanvas(ev)) {
                bbAddBlock(bbDragType, bbDropIdx >= 0 ? bbDropIdx : undefined);
            }
            bbDragType = null;
            bbDropIdx = -1;
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function isOverCanvas(ev) {
        var wrap = document.getElementById('bbCanvasWrap');
        if (!wrap) return false;
        var r = wrap.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right &&
               ev.clientY >= r.top  && ev.clientY <= r.bottom;
    }

    function updateDropIndicator(ev) {
        clearDropIndicators();
        var canvas = document.getElementById('bbCanvas');
        if (!canvas) return;
        var blocks = canvas.querySelectorAll('.bb-block-svgwrap');
        bbDropIdx = blocks.length;
        blocks.forEach(function(blk, i) {
            var r = blk.getBoundingClientRect();
            var mid = r.top + r.height / 2;
            if (ev.clientY < mid) {
                bbDropIdx = i;
                blk.classList.add('bb-block-svgwrap--drop-before');
            }
        });
    }

    function clearDropIndicators() {
        var canvas = document.getElementById('bbCanvas');
        if (!canvas) return;
        canvas.querySelectorAll('.bb-block-svgwrap--drop-before').forEach(function(b) {
            b.classList.remove('bb-block-svgwrap--drop-before');
        });
    }

    function bbCompile() {
        var result = [];
        cfgKeys && cfgKeys.forEach(function(key, idx) {
            bbLayers.forEach(function(lyr) {
                var script = bbScripts[lyr.id + ':' + idx];
                if (!script || script.length === 0) return;
                var hat = script[0];
                var actions = script.slice(1).map(function(b) {
                    return Object.assign({ type: b.type }, b.data);
                });
                result.push({
                    key_address: '0x' + (key.address).toString(16).padStart(2, '0'),
                    channel: key.channel,
                    layer: lyr.id,
                    trigger: hat.type,
                    trigger_data: hat.data,
                    actions: actions
                });
            });
        });
        return result;
    }

});

