/**
 * Escapes any occurances of &, ", <, > or / with XML entities.
 *
 * @param {string} str
 *        The string to escape.
 * @return {string} The escaped string.
 */
function escapeXML(str) {
  const replacements = {"&": "&amp;", "\"": "&quot;", "'": "&apos;", "<": "&lt;", ">": "&gt;", "/": "&#x2F;"};
  return String(str).replace(/[&"'<>/]/g, m => replacements[m]);
}

/**
 * A tagged template function which escapes any XML metacharacters in
 * interpolated values.
 *
 * @param {Array<string>} strings
 *        An array of literal strings extracted from the templates.
 * @param {Array} values
 *        An array of interpolated values extracted from the template.
 * @returns {string}
 *        The result of the escaped values interpolated with the literal
 *        strings.
 */
function escaped(strings, ...values) {
  const result = [];

  for (const [i, string] of strings.entries()) {
    result.push(string);
    if (i < values.length)
      result.push(escapeXML(values[i]));
  }

  return result.join("");
}

function debug() {
  if (false) {
    console.log(...arguments);
  }
}

const DEFAULT_FAVICON = "/img/defaultFavicon.svg";
const DEFAULT_LOADING = "chrome://global/skin/icons/loading@2x.png";

const tabManager = {
  currentContainers: [],
  currentTabs: new Map(),
  sidebar: null,
  draggedOver: null,
  draggingTab: null,
  loaded: false,
  showContainersAdvert: false,
  // fired when context menu is triggered
  currentContext: null,

  init() {
    this.getContainers();
    this.loadTabs();
    this.addListeners();
  },

  load() {
    this.sidebar = document.getElementById("sidebarContainer");
    const tabItemMenu = document.getElementById("tab-item-menu");
    document.addEventListener("click", this);
    tabItemMenu.addEventListener("click", this);
    this.loaded = true;
    this.render();
  },

  addListeners() {
    browser.tabs.onActivated.addListener((activated) => {
      const activeTab = this.getTabById(activated.tabId);
      if (activeTab) {
        this.currentTabs.forEach((tabInstance) => {
          tabInstance.active = false;
        });

        activeTab.active = true;
      }
    });
    browser.tabs.onRemoved.addListener((removed) => {
      const tabInstance = this.getTabById(removed);
      if (tabInstance) {
        tabInstance.remove();
      }
    });
/* not sure if I need these yet
    browser.tabs.onAttached.addListener(refreshTabs);
    browser.tabs.onDetached.addListener(refreshTabs);
    browser.tabs.onReplaced.addListener(refreshTabs);
*/
    // We could potentially stale check here but it might get out of date
    // tracking the tabs state in memory might be more performant though
    const refreshTabs = (tab) => {
      // In case the user adds more containers (we need events really etc)
      //this.getContainers();
      this.loadTabs();
    };
    browser.tabs.onCreated.addListener(refreshTabs);
    // TODO clear these up, also handle pinning here as move is called
    browser.tabs.onMoved.addListener(refreshTabs);
    // Once I handle everything this can be removed
    // This overfires right now but clears up stale tabs
    browser.tabs.onUpdated.addListener((tabId, update, tab) => {
      debug("update", tabId, update, tab);
      const tabInstance = this.getTabById(tabId);
      if (tabInstance) {
        tabInstance.update(tab);
      }
    });
  },

  getTabById(id) {
    return this.currentTabs.get(id);
  },

  loadTabs() {
    return browser.tabs.query({
      windowId: browser.windows.WINDOW_ID_CURRENT
    }).then((tabs) => {
      debug('tab', tabs);
      this.currentTabs = new Map();
      tabs.forEach((tab) => {
        this.currentTabs.set(tab.id, this.createTabInstance(tab));
      });

      return this.renderTabs();
    });
  },

  hasContainersSupport() {
    return browser.contextualIdentities !== undefined;
  },
  
  getContainers() {
    const defaultContainer = {
      cookieStoreId: 'firefox-default',
      name: "Default"
    };
    this.currentContainers = [];
    this.showContainersAdvert = false;
    if (this.hasContainersSupport()) {
      browser.contextualIdentities.query({
      }).then((containers) => {
        debug('got containers', containers);
        this.currentContainers = containers;
        this.currentContainers.unshift(defaultContainer);
        this.render();
      });
    } else {
      this.showContainersAdvert = true;
      this.currentContainers.unshift(defaultContainer);
      this.render();
    }
  },

  toggleAdvert() {
    const containersAdvertElement = document.getElementById("containersAdvert");
    containersAdvertElement.hidden = !this.showContainersAdvert;
  },

  render() {
    debug('rendering', this.currentContainers, this.currentTabs);
    if (!this.loaded) {
      return;
    }
    this.toggleAdvert();
    const fragment = document.createDocumentFragment();
  
    this.currentContainers.forEach((container) => {
      const containerElement = document.createElement("section");
      containerElement.className = "closed";
      containerElement.innerHTML = escaped`<div class="container">
        <div class="usercontext-icon"></div>
        <div class="container-name">
          ${container.name}
        </div>
        <span class="tab-count"></span>
        <div class="pinned-tabs"></div>
        <button class="new-tab" title="Open new ${container.name} tab"></button>
      </div>`;
      containerElement.setAttribute("data-identity-icon", container.icon);
      containerElement.setAttribute("data-identity-color", container.color);
      containerElement.setAttribute("data-cookie-store-id", container.cookieStoreId);
      const tabContainerElement = document.createElement("div");
      tabContainerElement.className = "tab-container";
      containerElement.appendChild(tabContainerElement);

      fragment.appendChild(containerElement);
    });
    this.sidebar.innerHTML = "";
    this.sidebar.appendChild(fragment);
  
    this.renderTabs();
  },

  containerOpen(sectionElement, toggle) {
    let isOpen = false;
    if (!sectionElement.classList.contains("closed")) {
      isOpen = true;
    }
    [...this.sidebar.querySelectorAll("section")].forEach((section) => {
      section.classList.add("closed");
    });

    if (!toggle || !isOpen) {
      sectionElement.classList.remove("closed");
      if (toggle) {
        // Lets open the first tab on user click
        // This was annoying
        //this.tabActivate(sectionElement.querySelector('.tab-item'));
      }
    }
  },

  menuItemFire(e) {
    debug("menuitem", e, this.currentContext, e.target.parentNode, e.target.parentNode.parentNode);
    if (this.currentContext) {
      switch (e.target.id) {
        case "pinTab":
          this.currentContext.pin();
          break;
        case "unpinTab":
          this.currentContext.pin(false);
          break;
        case "reloadTab":
          this.currentContext.reload();
          break;
        case "muteTab":
          this.currentContext.mute();
          break;
        case "unmuteTab":
          this.currentContext.mute(false);
          break;
      }
      this.currentContext = false;
    }
  },

  handleEvent(e) {
    debug("event", e);
    switch (e.type) {
      case "click":
        if (e.target.tagName === "MENUITEM") {
          this.menuItemFire(e);
        } else {
          const sectionElement = e.target.closest("section");
          if (e.target.tagName === "BUTTON") {
            browser.tabs.create({
              cookieStoreId: sectionElement.getAttribute("data-cookie-store-id")
            });
            return;
          }
          // If middle click is pressed, for some reason firefox doesn't support it locally on the menuitem
          // https://bugzilla.mozilla.org/show_bug.cgi?id=864096
          if (e.button === 1) {
            let tabElement = e.target;
            tabElement = tabElement.closest(".tab-item");
            // close tab.
            browser.tabs.remove(Number(tabElement.dataset.tabId));
            e.preventDefault();
            return;
          }
          this.containerOpen(sectionElement, true);
        }
      case "dragstart":
        this.draggingTab = e.target;
        this.draggingTab.classList.add("dragging");
        e.dataTransfer.setData("text/plain", e.target.id);
        break;
      case "dragover":
        if (this.draggedOver === e.target) {
          return;
        }
        if (this.draggedOver) {
          this.draggedOver.classList.remove("over");
        }

        const thisDraggingOverTabElement = e.target.closest(".tab-item");
        thisDraggingOverTabElement.classList.add("over");
        this.draggedOver = thisDraggingOverTabElement;
        break;
      case "dragend":
        this.draggingTab.classList.remove("dragging");
        const tabId = Number(this.draggingTab.getAttribute("data-tab-id"));
        if (tabId && this.draggedOver) {
          const draggingOverTabId = Number(this.draggedOver.getAttribute("data-tab-id"));
          browser.tabs.get(draggingOverTabId).then((draggingOverTab) => {
            browser.tabs.move(tabId, {
              index: draggingOverTab.index + 1
            });
          });
        }
        this.draggingTab = null;
        this.draggedOver = null;
        break;
    }
  },

  createTabInstance(tab) {
    return new TabInstance(tab);
  },

  renderTabs() {
    const containerTabs = {};
    const pinnedTabs = {};
    let activeTab;

    const makeTab = (storage, tabInstance, pinned) => {
      const cookieStoreId = tabInstance.cookieStoreId;
      if (!(cookieStoreId in storage)) {
        storage[cookieStoreId] = document.createDocumentFragment();
      }

      if (tabInstance.active) {
        activeTab = tabInstance;
      }
      storage[cookieStoreId].appendChild(tabInstance.render());
    };
  
    this.currentTabs.forEach((tabInstance) => {
      if (tabInstance.pinned) {
        makeTab(pinnedTabs, tabInstance, true);
      } else {
        makeTab(containerTabs, tabInstance);
      }
    });
  
    [...document.querySelectorAll('section')].forEach((section) => {
      const tabCountElement = section.querySelector(".tab-count");
      const tabContainer = section.querySelector(".tab-container");
      const cookieStoreId = section.getAttribute("data-cookie-store-id");
      debug("found section", tabContainer, cookieStoreId, section, containerTabs[cookieStoreId]);
      if (cookieStoreId in containerTabs) {
        const tabCount = containerTabs[cookieStoreId].childNodes.length;
        if (tabCount > 0) {
          section.classList.add("expandable");
          tabCountElement.innerText = `(${tabCount})`;
        }
        tabContainer.innerHTML = "";
        tabContainer.appendChild(containerTabs[cookieStoreId]);
      }

      if (cookieStoreId in pinnedTabs) {
        const pinnedSection = section.querySelector(".pinned-tabs");
        pinnedSection.innerHTML = "";
        pinnedSection.appendChild(pinnedTabs[cookieStoreId]);
      }
    });

    return activeTab;
  }
};


class TabInstance {
  constructor(tabData) {
    this.tabData = tabData;
    this.cookieStoreId = tabData.cookieStoreId;
  }

  get pinned() {
    return this.tabData.pinned;
  }

  get active() {
    return this.tabData.active;
  }

  set active(isActive) {
    if (isActive !== this.tabData.active) {
      this.tabData.active = isActive;
      this.render();
      if (isActive) {
        this.scrollIntoView();
        /* neaten this up to message pass */
        const sectionElement = this.tabElement.closest("section");
        tabManager.containerOpen(sectionElement);
      }
    }
    return this.tabData.active;
  }

  update(tabData) {
    this.tabData = tabData;
    this.render();
  }

  render() {
    const cookieStoreId = this.tabData.cookieStoreId;
    const tabElement = document.createElement("a");
    tabElement.className = "tab-item";
    tabElement.setAttribute("contextmenu", "tab-item-menu");
    tabElement.setAttribute("href", this.tabData.url);
    const pinned = this.tabData.pinned;
    if (!pinned) {
      tabElement.setAttribute("draggable", true);
    }
    tabElement.setAttribute("data-tab-id", this.tabData.id);
    // These methods really should move to somewhere else however they rely on state tracking TODO
    tabElement.addEventListener("dragstart", tabManager);
    tabElement.addEventListener("dragover", tabManager);
    tabElement.addEventListener("dragend", tabManager);
    debug("Found tab", this.tabData);
    if (this.tabData.active) {
      tabElement.classList.add("active");
    }
    let favIconUrl = DEFAULT_FAVICON;
    if (this.tabData.status !== "complete") {
      favIconUrl = DEFAULT_LOADING;
    } else {
      if ("favIconUrl" in this.tabData) {
        favIconUrl = this.tabData.favIconUrl;
      }
    }
    if (pinned) {
      tabElement.innerHTML = escaped`
        <img src="${favIconUrl}" class="favicon offpage" title="${this.tabData.title}" />
      `;
    } else {
      tabElement.innerHTML = escaped`
        <img src="${favIconUrl}" class="offpage" title="${this.tabData.title}" />
        <div class="tab-title">${this.tabData.title}</div>
        <button class="close-tab" title="Close tab"></button>`;
    }
    if (this.tabData.audible) {
      tabElement.classList.add("sound-playing");
    }
    const muted = this.tabData.mutedInfo.muted;
    if (muted) {
      tabElement.classList.add("muted");
    }
    const imageElement = tabElement.querySelector("img");
    imageElement.addEventListener("error", this);
    imageElement.addEventListener("load", this);

    tabElement.addEventListener("click", this);
    tabElement.addEventListener("keydown", this);
    tabElement.addEventListener("contextmenu", this);

    if (this.tabElement) {
      this.tabElement.replaceWith(tabElement);
    }
    this.tabElement = tabElement;
    return tabElement;
  }

  handleEvent(e) {
    debug("tab event", e);
    switch (e.type) {
      case "contextmenu":
        tabManager.currentContext = this;
        const pinned = this.tabData.pinned;
        const muted = this.tabData.mutedInfo.muted;
        document.getElementById("unpinTab").hidden = !pinned;
        document.getElementById("pinTab").hidden = pinned;
        document.getElementById("unmuteTab").hidden = !muted;
        document.getElementById("muteTab").hidden = muted;
        break;
      case "error":
        /* load and error handle missing favicons, about: and WhatsApp have issues here.
           This causes the app to flicker on rerender... however this indicates a redraw, let's fix how regular that is before anything else like caching
         */
        e.target.setAttribute("src", DEFAULT_FAVICON);
        break;
      case "load":
        e.target.classList.remove("offpage");
        e.target.removeEventListener("load", this);
        e.target.removeEventListener("error", this);
        break;
      case "click":
        if (e.target.tagName === "BUTTON") {
          this.tabClose();
        } else {
          this.tabActivate();
        }
        /* Stop us triggering clicks in the parent section */
        e.stopPropagation();
        /* As we are a link element stop loading the tab in a new tab */
        e.preventDefault();
        break;
    }
  }

  tabClose() {
    browser.tabs.remove(Number(this.tabData.id));
  }

  tabActivate() {
    browser.tabs.update(Number(this.tabData.id), {
      active: true
    });
  }

  scrollIntoView() {
    this.tabElement.scrollIntoView({block: "end", behavior: "smooth"});
  }

  /* fired on tab close event. clear up event handlers here */
  remove() {
    this.tabElement.remove();
  }

  reload() {
    browser.tabs.reload(this.tabData.id);
  }

  mute(state = true) {
    browser.tabs.update(this.tabData.id, {muted: state});
  }

  pin(state = true) {
    browser.tabs.update(this.tabData.id, {pinned: state});
  }
}

tabManager.init();

document.addEventListener("DOMContentLoaded", () => {
  tabManager.load();
});
