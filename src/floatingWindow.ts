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
    // Create main container
    this.element = document.createElement("div")

    // Set ID if provided
    if (this.options.id) {
      this.element.id = this.options.id
    }

    // Find an element with class ending in -overviewContainer to steal its styling
    const overviewElement = document.querySelector(
      '[class*="-overviewContainer"]'
    ) as HTMLElement

    // Extract the full class name that ends with -overviewContainer
    const classList = Array.from(overviewElement.classList)
    const overviewClassName = classList.find((cls) =>
      cls.endsWith("-overviewContainer")
    )!

    this.element.className = overviewClassName

    // Get the position and dimensions of the overview element to position next to it
    const rect = overviewElement.getBoundingClientRect()

    // Get the transform values of the overview element
    const style = window.getComputedStyle(overviewElement)
    const matrix = new DOMMatrix(style.transform)
    const overviewX = matrix.m41 || 0
    const overviewY = matrix.m42 || 0

    // Position at transform X + element width
    const windowX = overviewX + overviewElement.style.width
    const windowY = overviewY // Align with the same Y position

    // Apply only essential positioning - no other CSS
    this.element.style.position = "fixed"
    this.element.style.zIndex = "1000"
    this.element.style.transform = `translate(${windowX}px, ${windowY}px)`
    this.element.style.width = `${this.options.width}px`
    if (!this.isCollapsed) {
      this.element.style.height = `${this.options.height}px`
    }

    // Create header
    const header = document.createElement("div")
    header.className = this.options.draggable ? "drag" : ""

    // Create header content
    const headerContent = document.createElement("div")

    // Add title
    const title = document.createElement("p")
    title.textContent = "title"
    headerContent.appendChild(title)

    // Add collapse button if collapsible
    if (this.options.collapsible) {
      const collapseBtn = document.createElement("button")
      collapseBtn.innerHTML = this.isCollapsed ? "▼" : "▲"
      collapseBtn.onclick = () => this.toggle()
      headerContent.appendChild(collapseBtn)
    }

    // Add close button if closable
    if (this.options.closable) {
      const closeBtn = document.createElement("button")
      closeBtn.innerHTML = "✕"
      closeBtn.onclick = () => this.close()
      headerContent.appendChild(closeBtn)
    }

    header.appendChild(headerContent)

    // Create content area
    const contentArea = document.createElement("div")
    if (this.isCollapsed) {
      contentArea.style.display = "none"
    }
    contentArea.innerHTML = "window"

    // Assemble the window
    this.element.appendChild(header)
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
    const collapseBtn = this.element?.querySelector("button") as HTMLElement

    if (contentArea) {
      contentArea.style.display = this.isCollapsed ? "none" : "block"
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

    const contentContainer = this.element.children[1] // Second child is content area
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

// Convenience function for quick window creation
export function createFloatingWindow(
  options: FloatingWindowOptions = {}
): FloatingWindow {
  return new FloatingWindow(options)
}
