// Style constants based on Bitburner UI analysis
const STYLE_A_CLASSES = {
  container: "css-zqk033-overviewContainer",
  tableRow: "css-1dix92e",
  icon: "css-11dx3ry-icon",
  iconSecondary: "css-gsuung-icon",
  typography: "css-156sm58",
  visibilityToggle: "css-1stirav-visibilityToggle",
  button: "css-jhk36g",
  iconPrimary: "css-wz14si",
  iconError: "css-ahfcdp",
  progressBar: "css-15ngs1i",
  progressBarAlt: "css-koo86v",
  progressBarSpecial: "css-3x86pa",
  progressBarInner: "css-14usnx9",
}

const STYLE_B_CLASSES = {
  container: "css-1m2n216-overviewContainer",
  tableRow: "css-3ozfvu",
  icon: "css-1bpz3m4-icon",
  iconSecondary: "css-1b0w8p7-icon",
  typography: "css-1escon8",
  visibilityToggle: "css-15whgr8-visibilityToggle",
  button: "css-1yv3pk3",
  iconPrimary: "css-17jxivj",
  iconError: "css-1to0ixh",
  progressBar: "css-1wcuaas",
  progressBarAlt: "css-15sn5zg",
  progressBarSpecial: "css-19df07u",
  progressBarInner: "css-f14f7s",
}

// Base MUI classes that are common to both styles
const BASE_MUI_CLASSES = {
  paper:
    "MuiPaper-root MuiPaper-elevation MuiPaper-elevation1 react-draggable react-draggable-dragged",
  box: "MuiBox-root",
  dragHandle: "drag",
  header: "css-19262ez-header",
  svgIcon:
    "MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium",
  typography: "MuiTypography-root MuiTypography-body1",
  button:
    "MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall",
  collapse:
    "MuiCollapse-root MuiCollapse-vertical MuiCollapse-entered css-1iz2152-collapse",
  collapseWrapper: "MuiCollapse-wrapper MuiCollapse-vertical css-hboir5",
  collapseInner: "MuiCollapse-wrapperInner MuiCollapse-vertical css-8atqhb",
  table: "MuiTable-root css-1xsw7rv",
  tableBody: "MuiTableBody-root css-1xnox0e",
  touchRipple: "MuiTouchRipple-root css-w0pj6f",
}

export type StyleVariant = "A" | "B" | "C"

interface FloatingWindowOptions {
  title?: string
  content?: string
  x?: number
  y?: number
  width?: number
  height?: number
  styleVariant?: StyleVariant
  draggable?: boolean
  collapsible?: boolean
  closable?: boolean
}

export class FloatingWindow {
  private element: HTMLElement | null = null
  private isDragging = false
  private dragOffset = { x: 0, y: 0 }
  private isCollapsed = false
  private options: Required<FloatingWindowOptions>

  constructor(options: FloatingWindowOptions = {}) {
    this.options = {
      title: options.title || "Floating Window",
      content: options.content || "<p>Default content</p>",
      x: options.x || 100,
      y: options.y || 100,
      width: options.width || 300,
      height: options.height || 200,
      styleVariant: options.styleVariant || "C",
      draggable: options.draggable !== false,
      collapsible: options.collapsible !== false,
      closable: options.closable !== false,
    }

    this.createElement()
    this.attachEventListeners()
  }

  private getStyleClasses(): typeof STYLE_A_CLASSES {
    switch (this.options.styleVariant) {
      case "A":
        return STYLE_A_CLASSES
      case "B":
        return STYLE_B_CLASSES
      case "C":
      default:
        // No additional classes for variant C (minimal style)
        return {} as typeof STYLE_A_CLASSES
    }
  }

  private createElement(): void {
    const styleClasses = this.getStyleClasses()
    const useMuiClasses = this.options.styleVariant !== "C"

    // Create main container
    this.element = document.createElement("div")

    if (useMuiClasses) {
      this.element.className = `${BASE_MUI_CLASSES.paper} ${styleClasses.container}`
    } else {
      this.element.className = "floating-window-minimal"
      this.element.style.cssText = `
        position: fixed;
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid #444;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: 'Roboto', sans-serif;
        font-size: 14px;
        color: #fff;
        z-index: 1000;
        min-width: 200px;
        max-width: 800px;
      `
    }

    this.element.style.transform = `translate(${this.options.x}px, ${this.options.y}px)`
    this.element.style.width = `${this.options.width}px`
    if (!this.isCollapsed) {
      this.element.style.height = `${this.options.height}px`
    }

    // Create header
    const header = document.createElement("div")
    if (useMuiClasses) {
      header.className = `${this.options.draggable ? "drag " : ""}${BASE_MUI_CLASSES.box} css-0`
    } else {
      header.className = this.options.draggable
        ? "drag floating-window-header"
        : "floating-window-header"
      header.style.cssText = `
        padding: 12px 16px;
        border-bottom: 1px solid #444;
        cursor: ${this.options.draggable ? "move" : "default"};
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(40, 40, 40, 0.8);
        border-radius: 8px 8px 0 0;
      `
    }

    // Create header content
    const headerContent = document.createElement("div")
    if (useMuiClasses) {
      headerContent.className = `${BASE_MUI_CLASSES.box} ${BASE_MUI_CLASSES.header}`
    } else {
      headerContent.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
      `
    }

    // Add title
    const title = document.createElement("p")
    if (useMuiClasses) {
      title.className = `${BASE_MUI_CLASSES.typography} ${styleClasses.typography || "css-156sm58"}`
    } else {
      title.style.cssText = `
        margin: 0;
        font-weight: 500;
        color: #fff;
      `
    }
    title.textContent = this.options.title

    headerContent.appendChild(title)

    // Add collapse button if collapsible
    if (this.options.collapsible) {
      const collapseBtn = document.createElement("button")
      if (useMuiClasses) {
        collapseBtn.className = `${BASE_MUI_CLASSES.button} ${styleClasses.visibilityToggle || "css-1stirav-visibilityToggle"}`
      } else {
        collapseBtn.style.cssText = `
          background: none;
          border: none;
          color: #aaa;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: color 0.2s;
        `
      }
      collapseBtn.innerHTML = this.isCollapsed ? "▼" : "▲"
      collapseBtn.onclick = () => this.toggle()
      headerContent.appendChild(collapseBtn)
    }

    // Add close button if closable
    if (this.options.closable) {
      const closeBtn = document.createElement("button")
      if (useMuiClasses) {
        closeBtn.className = `${BASE_MUI_CLASSES.button} ${styleClasses.button || "css-jhk36g"}`
      } else {
        closeBtn.style.cssText = `
          background: none;
          border: none;
          color: #f44336;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          font-weight: bold;
          margin-left: 8px;
        `
      }
      closeBtn.innerHTML = "✕"
      closeBtn.onclick = () => this.close()
      headerContent.appendChild(closeBtn)
    }

    header.appendChild(headerContent)

    // Create content area
    const contentArea = document.createElement("div")
    if (useMuiClasses) {
      contentArea.className = `${BASE_MUI_CLASSES.collapse}`
      contentArea.style.minHeight = "0px"
    } else {
      contentArea.className = "floating-window-content"
      contentArea.style.cssText = `
        padding: 16px;
        overflow: auto;
        ${this.isCollapsed ? "display: none;" : ""}
      `
    }

    // Create content wrapper (for MUI structure)
    if (useMuiClasses) {
      const wrapper = document.createElement("div")
      wrapper.className = BASE_MUI_CLASSES.collapseWrapper
      const innerWrapper = document.createElement("div")
      innerWrapper.className = BASE_MUI_CLASSES.collapseInner
      innerWrapper.innerHTML = this.options.content
      wrapper.appendChild(innerWrapper)
      contentArea.appendChild(wrapper)
    } else {
      contentArea.innerHTML = this.options.content
    }

    // Assemble the window
    this.element.appendChild(header)
    this.element.appendChild(contentArea)

    // Add to document
    document.body.appendChild(this.element)
  }

  private attachEventListeners(): void {
    if (!this.element || !this.options.draggable) return

    const dragHandle = this.element.querySelector(".drag") as HTMLElement
    if (!dragHandle) return

    dragHandle.addEventListener("mousedown", (e) => {
      this.isDragging = true
      const rect = this.element!.getBoundingClientRect()
      this.dragOffset.x = e.clientX - rect.left
      this.dragOffset.y = e.clientY - rect.top
      e.preventDefault()
    })

    document.addEventListener("mousemove", (e) => {
      if (!this.isDragging || !this.element) return

      const x = e.clientX - this.dragOffset.x
      const y = e.clientY - this.dragOffset.y

      this.element.style.transform = `translate(${x}px, ${y}px)`
    })

    document.addEventListener("mouseup", () => {
      this.isDragging = false
    })
  }

  public toggle(): void {
    this.isCollapsed = !this.isCollapsed
    const contentArea = this.element?.querySelector(
      ".MuiCollapse-root, .floating-window-content"
    ) as HTMLElement
    const collapseBtn = this.element?.querySelector("button") as HTMLElement

    if (contentArea) {
      if (this.options.styleVariant !== "C") {
        // MUI style toggle
        contentArea.style.display = this.isCollapsed ? "none" : "block"
      } else {
        // Minimal style toggle
        contentArea.style.display = this.isCollapsed ? "none" : "block"
      }
    }

    if (collapseBtn) {
      collapseBtn.innerHTML = this.isCollapsed ? "▼" : "▲"
    }

    // Adjust window height
    if (this.element) {
      if (this.isCollapsed) {
        this.element.style.height = "auto"
      } else {
        this.element.style.height = `${this.options.height}px`
      }
    }
  }

  public close(): void {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
      this.element = null
    }
  }

  public show(): void {
    if (this.element) {
      this.element.style.display = "block"
    }
  }

  public hide(): void {
    if (this.element) {
      this.element.style.display = "none"
    }
  }

  public updateContent(newContent: string): void {
    if (!this.element) return

    const contentContainer = this.element.querySelector(
      ".MuiCollapse-wrapperInner, .floating-window-content"
    )
    if (contentContainer) {
      contentContainer.innerHTML = newContent
    }
  }

  public updateTitle(newTitle: string): void {
    if (!this.element) return

    const titleElement = this.element.querySelector("p")
    if (titleElement) {
      titleElement.textContent = newTitle
    }
  }

  public setPosition(x: number, y: number): void {
    if (this.element) {
      this.element.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  public getElement(): HTMLElement | null {
    return this.element
  }
}

// Convenience functions for quick window creation
export function createFloatingWindow(
  options: FloatingWindowOptions = {}
): FloatingWindow {
  return new FloatingWindow(options)
}

export function createStyleAWindow(
  title: string,
  content: string,
  x = 100,
  y = 100
): FloatingWindow {
  return new FloatingWindow({
    title,
    content,
    x,
    y,
    styleVariant: "A",
  })
}

export function createStyleBWindow(
  title: string,
  content: string,
  x = 100,
  y = 100
): FloatingWindow {
  return new FloatingWindow({
    title,
    content,
    x,
    y,
    styleVariant: "B",
  })
}

export function createMinimalWindow(
  title: string,
  content: string,
  x = 100,
  y = 100
): FloatingWindow {
  return new FloatingWindow({
    title,
    content,
    x,
    y,
    styleVariant: "C",
  })
}
