interface FloatingWindowOptions {
  title?: string
  content?: string
  x?: number
  y?: number
  width?: number
  height?: number
  draggable?: boolean
  collapsible?: boolean
  closable?: boolean
  attachTo?: HTMLElement
  id?: string
}

export class FloatingWindow {
  private element: HTMLElement | null = null
  private isDragging = false
  private dragOffset = { x: 0, y: 0 }
  private isCollapsed = false
  private options: Required<Omit<FloatingWindowOptions, "attachTo" | "id">> & {
    attachTo?: HTMLElement
    id?: string
  }

  constructor(options: FloatingWindowOptions = {}) {
    this.options = {
      title: options.title || "Floating Window",
      content: options.content || "<p>Default content</p>",
      x: options.x || 100,
      y: options.y || 100,
      width: options.width || 300,
      height: options.height || 200,
      draggable: options.draggable !== false,
      collapsible: options.collapsible !== false,
      closable: options.closable !== false,
      attachTo: options.attachTo,
      id: options.id,
    }

    this.createElement()
    this.attachEventListeners()
  }

  private createElement(): void {
    // Find the overview element to copy styling and position next to it
    const overviewElement = document.querySelector(
      '[class*="-overviewContainer"]'
    ) as HTMLElement

    if (!overviewElement) {
      throw new Error("Could not find overview container element")
    }

    // Create main container with exact MUI classes
    this.element = document.createElement("div")
    this.element.className =
      "MuiPaper-root MuiPaper-elevation MuiPaper-elevation1 react-draggable react-draggable-dragged css-6zfywf-overviewContainer"

    // Set ID if provided
    if (this.options.id) {
      this.element.id = this.options.id
    }

    // Get the transform values of the overview element
    const style = window.getComputedStyle(overviewElement)
    const matrix = new DOMMatrix(style.transform)
    const overviewX = matrix.m41 || 0
    const overviewY = matrix.m42 || 0

    // Position next to the overview element
    const windowX = overviewX + 150 // Offset by overview width
    const windowY = overviewY

    // Apply transform positioning
    this.element.style.transform = `translate(${windowX}px, ${windowY}px)`

    // Create drag container
    const dragContainer = document.createElement("div")
    dragContainer.className = "drag MuiBox-root css-0"

    // Create header
    const header = document.createElement("div")
    header.className = "MuiBox-root css-19262ez-header"

    // Create icon SVG
    const iconSvg = document.createElement("svg")
    iconSvg.className =
      "MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium css-11dx3ry-icon"
    iconSvg.setAttribute("focusable", "false")
    iconSvg.setAttribute("aria-hidden", "true")
    iconSvg.setAttribute("viewBox", "0 0 24 24")
    iconSvg.setAttribute("data-testid", "EqualizerIcon")
    iconSvg.innerHTML =
      '<path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z"></path>'

    // Create title
    const title = document.createElement("p")
    title.className = "MuiTypography-root MuiTypography-body1 css-1syun94"
    title.textContent = this.options.title

    // Add icon and title to header
    header.appendChild(iconSvg)
    header.appendChild(title)

    // Add collapse button if collapsible
    if (this.options.collapsible) {
      const collapseBtn = document.createElement("button")
      collapseBtn.className =
        "MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall css-1v4s0p7-visibilityToggle"
      collapseBtn.setAttribute("tabindex", "0")
      collapseBtn.setAttribute("type", "button")
      collapseBtn.setAttribute(
        "aria-label",
        "expand or collapse character overview"
      )

      // Create collapse icon SVG
      const collapseSvg = document.createElement("svg")
      collapseSvg.className =
        "MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium css-gsuung-icon"
      collapseSvg.setAttribute("focusable", "false")
      collapseSvg.setAttribute("aria-hidden", "true")
      collapseSvg.setAttribute("viewBox", "0 0 24 24")
      collapseSvg.setAttribute(
        "data-testid",
        this.isCollapsed ? "KeyboardArrowDownIcon" : "KeyboardArrowUpIcon"
      )
      collapseSvg.innerHTML = this.isCollapsed
        ? '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path>'
        : '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"></path>'

      // Create touch ripple span
      const touchRipple = document.createElement("span")
      touchRipple.className = "MuiTouchRipple-root css-w0pj6f"

      collapseBtn.appendChild(collapseSvg)
      collapseBtn.appendChild(touchRipple)
      collapseBtn.onclick = () => this.toggle()

      header.appendChild(collapseBtn)
    }

    // Add close button if closable
    if (this.options.closable) {
      const closeBtn = document.createElement("button")
      closeBtn.className =
        "MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall css-1v4s0p7-visibilityToggle"
      closeBtn.innerHTML = "✕"
      closeBtn.onclick = () => this.close()
      header.appendChild(closeBtn)
    }

    // Add header to drag container
    dragContainer.appendChild(header)

    // Create content area with MuiCollapse structure
    const contentArea = document.createElement("div")
    contentArea.style.minHeight = "0px"
    contentArea.style.transitionDuration = "300ms"

    // Set initial collapse state
    if (this.isCollapsed) {
      contentArea.className =
        "MuiCollapse-root MuiCollapse-vertical css-1iz2152-collapse"
      contentArea.style.height = "0px"
    } else {
      contentArea.className =
        "MuiCollapse-root MuiCollapse-vertical MuiCollapse-entered css-1iz2152-collapse"
      contentArea.style.height = "auto"
    }

    // Create inner content container
    const innerContent = document.createElement("div")
    innerContent.innerHTML = this.options.content
    contentArea.appendChild(innerContent)

    // Assemble the window
    this.element.appendChild(dragContainer)
    this.element.appendChild(contentArea)

    // Insert as sibling after the overview element
    overviewElement.parentNode!.insertBefore(
      this.element,
      overviewElement.nextSibling
    )
  }

  private attachEventListeners(): void {
    if (!this.element || !this.options.draggable) return

    const dragHandle = this.element.querySelector(".drag") as HTMLElement
    if (!dragHandle) return

    dragHandle.addEventListener("mousedown", (e) => {
      this.isDragging = true
      // Get the current transform values to maintain position
      const style = window.getComputedStyle(this.element!)
      const matrix = new DOMMatrix(style.transform)
      const currentX = matrix.m41 || 0
      const currentY = matrix.m42 || 0

      // Calculate offset from mouse position to current window position
      this.dragOffset.x = e.clientX - currentX
      this.dragOffset.y = e.clientY - currentY
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
    const contentArea = this.element?.children[1] as HTMLElement // Second child is content area
    const collapseBtn = this.element?.querySelector(
      ".css-1v4s0p7-visibilityToggle"
    ) as HTMLElement
    const collapseSvg = collapseBtn?.querySelector("svg") as SVGElement

    if (contentArea) {
      if (this.isCollapsed) {
        // Collapse: set height to 0 and update classes
        contentArea.style.height = "0px"
        contentArea.style.minHeight = "0px"
        contentArea.className =
          "MuiCollapse-root MuiCollapse-vertical css-1iz2152-collapse"
      } else {
        // Expand: restore height and update classes
        contentArea.style.height = "auto"
        contentArea.style.minHeight = "0px"
        contentArea.className =
          "MuiCollapse-root MuiCollapse-vertical MuiCollapse-entered css-1iz2152-collapse"
      }
    }

    if (collapseSvg) {
      // Update SVG icon and data-testid
      collapseSvg.setAttribute(
        "data-testid",
        this.isCollapsed ? "KeyboardArrowDownIcon" : "KeyboardArrowUpIcon"
      )
      collapseSvg.innerHTML = this.isCollapsed
        ? '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path>'
        : '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"></path>'
    }

    // Let the container size adjust naturally
    if (this.element) {
      this.element.style.height = "auto"
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

    const contentContainer = this.element.children[1] // Second child is content area (MuiCollapse)
    const innerContent = contentContainer?.children[0] as HTMLElement // Inner content container
    if (innerContent) {
      innerContent.innerHTML = newContent
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

// Convenience function for quick window creation
export function createFloatingWindow(
  options: FloatingWindowOptions = {}
): FloatingWindow {
  return new FloatingWindow(options)
}
