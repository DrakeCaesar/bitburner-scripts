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

    this.element.className = "floating-window"
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

    this.element.style.transform = `translate(${this.options.x}px, ${this.options.y}px)`
    this.element.style.width = `${this.options.width}px`
    if (!this.isCollapsed) {
      this.element.style.height = `${this.options.height}px`
    }

    // Create header
    const header = document.createElement("div")
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

    // Create header content
    const headerContent = document.createElement("div")
    headerContent.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    `

    // Add title
    const title = document.createElement("p")
    title.style.cssText = `
      margin: 0;
      font-weight: 500;
      color: #fff;
    `
    title.textContent = this.options.title
    headerContent.appendChild(title)

    // Add collapse button if collapsible
    if (this.options.collapsible) {
      const collapseBtn = document.createElement("button")
      collapseBtn.style.cssText = `
        background: none;
        border: none;
        color: #aaa;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: color 0.2s;
      `
      collapseBtn.innerHTML = this.isCollapsed ? "▼" : "▲"
      collapseBtn.onclick = () => this.toggle()
      headerContent.appendChild(collapseBtn)
    }

    // Add close button if closable
    if (this.options.closable) {
      const closeBtn = document.createElement("button")
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
      closeBtn.innerHTML = "✕"
      closeBtn.onclick = () => this.close()
      headerContent.appendChild(closeBtn)
    }

    header.appendChild(headerContent)

    // Create content area
    const contentArea = document.createElement("div")
    contentArea.className = "floating-window-content"
    contentArea.style.cssText = `
      padding: 16px;
      overflow: auto;
      ${this.isCollapsed ? "display: none;" : ""}
    `
    contentArea.innerHTML = this.options.content

    // Assemble the window
    this.element.appendChild(header)
    this.element.appendChild(contentArea)

    // Add to document
    const targetElement = this.options.attachTo || document.body
    targetElement.appendChild(this.element)
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
    const contentArea = this.element?.querySelector(".floating-window-content") as HTMLElement
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

    const contentContainer = this.element.querySelector(".floating-window-content")
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
