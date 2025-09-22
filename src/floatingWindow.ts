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

// CSS class constants - extract these from #root > first child element
const CSS_CLASSES = {
  overviewContainer: "css-6zfywf-overviewContainer",
  dragContainer: "css-0",
  header: "css-19262ez-header",
  headerIcon: "css-11dx3ry-icon",
  headerTitle: "css-1syun94",
  visibilityToggle: "css-1v4s0p7-visibilityToggle",
  collapseIcon: "css-gsuung-icon",
  touchRipple: "css-w0pj6f",
  collapse: "css-1iz2152-collapse",
  collapseWrapper: "css-hboir5",
  collapseWrapperInner: "css-8atqhb",
  table: "css-9mpdia",
  tableBody: "css-1xnox0e",
  tableRow: "css-egt6ug",
  tableCell: "css-8kiwhy-cellNone",
  typography: "css-gy8k3f",
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

  private createSvgIcon(
    classes: string,
    testId: string,
    pathData: string
  ): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", classes)
    svg.setAttribute("focusable", "false")
    svg.setAttribute("aria-hidden", "true")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("data-testid", testId)
    svg.innerHTML = pathData
    return svg
  }

  private createButton(
    classes: string,
    ariaLabel: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = document.createElement("button")
    button.className = classes
    button.setAttribute("tabindex", "0")
    button.setAttribute("type", "button")
    button.setAttribute("aria-label", ariaLabel)
    button.onclick = onClick

    // Add touch ripple for MUI consistency
    const touchRipple = document.createElement("span")
    touchRipple.className = `MuiTouchRipple-root ${CSS_CLASSES.touchRipple}`
    button.appendChild(touchRipple)

    return button
  }

  private createCollapseButton(): HTMLButtonElement {
    const collapseBtn = this.createButton(
      `MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall ${CSS_CLASSES.visibilityToggle}`,
      "expand or collapse character overview",
      () => this.toggle()
    )

    const collapseSvg = this.createSvgIcon(
      `MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium ${CSS_CLASSES.collapseIcon}`,
      this.isCollapsed ? "KeyboardArrowDownIcon" : "KeyboardArrowUpIcon",
      this.isCollapsed
        ? '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path>'
        : '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"></path>'
    )

    // Insert SVG before the touch ripple
    collapseBtn.insertBefore(collapseSvg, collapseBtn.firstChild)
    return collapseBtn
  }

  private createCloseButton(): HTMLButtonElement {
    const closeBtn = this.createButton(
      `MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeSmall MuiButton-textSizeSmall ${CSS_CLASSES.visibilityToggle}`,
      "close window",
      () => this.close()
    )

    const closeSvg = this.createSvgIcon(
      `MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium ${CSS_CLASSES.collapseIcon}`,
      "CloseIcon",
      '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>'
    )

    // Insert SVG before the touch ripple
    closeBtn.insertBefore(closeSvg, closeBtn.firstChild)
    return closeBtn
  }

  private createHeader(): HTMLElement {
    const header = document.createElement("div")
    header.className = `MuiBox-root ${CSS_CLASSES.header}`

    // Create icon SVG
    const iconSvg = this.createSvgIcon(
      `MuiSvgIcon-root MuiSvgIcon-colorSecondary MuiSvgIcon-fontSizeMedium ${CSS_CLASSES.headerIcon}`,
      "EqualizerIcon",
      '<path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z"></path>'
    )

    // Create title
    const title = document.createElement("p")
    title.className = `MuiTypography-root MuiTypography-body1 ${CSS_CLASSES.headerTitle}`
    title.textContent = this.options.title

    // Add icon and title to header
    header.appendChild(iconSvg)
    header.appendChild(title)

    // Add buttons
    if (this.options.collapsible) {
      header.appendChild(this.createCollapseButton())
    }

    if (this.options.closable) {
      header.appendChild(this.createCloseButton())
    }

    return header
  }

  private createContentArea(): HTMLElement {
    const contentArea = document.createElement("div")
    contentArea.style.minHeight = "0px"
    contentArea.style.transitionDuration = "300ms"
    contentArea.style.width = "100%" // Ensure the collapse root fills horizontally

    // Set initial collapse state
    if (this.isCollapsed) {
      contentArea.className = `MuiCollapse-root MuiCollapse-vertical ${CSS_CLASSES.collapse}`
      contentArea.style.height = "0px"
    } else {
      contentArea.className = `MuiCollapse-root MuiCollapse-vertical MuiCollapse-entered ${CSS_CLASSES.collapse}`
      contentArea.style.height = "auto"
    }

    // Create the MuiCollapse wrapper structure
    const collapseWrapper = document.createElement("div")
    collapseWrapper.className = `MuiCollapse-wrapper MuiCollapse-vertical ${CSS_CLASSES.collapseWrapper}`

    const wrapperInner = document.createElement("div")
    wrapperInner.className = `MuiCollapse-wrapperInner MuiCollapse-vertical ${CSS_CLASSES.collapseWrapperInner}`

    // Create MUI table structure
    const table = document.createElement("table")
    table.className = `MuiTable-root ${CSS_CLASSES.table}`

    const tbody = document.createElement("tbody")
    tbody.className = `MuiTableBody-root ${CSS_CLASSES.tableBody}`

    // Create a sample table row (you can customize this)
    const tableRow = document.createElement("tr")
    tableRow.className = `MuiTableRow-root ${CSS_CLASSES.tableRow}`

    // Add content to the table row (you can modify this based on your needs)
    const tableCell = document.createElement("th")
    tableCell.className = `MuiTableCell-root MuiTableCell-body MuiTableCell-sizeMedium ${CSS_CLASSES.tableCell}`
    tableCell.setAttribute("scope", "row")

    // Create paragraph with MUI Typography classes
    const paragraph = document.createElement("p")
    paragraph.className = `MuiTypography-root MuiTypography-body1 ${CSS_CLASSES.typography}`
    paragraph.innerHTML = this.options.content

    tableCell.appendChild(paragraph)
    tableRow.appendChild(tableCell)

    // Assemble table structure
    tbody.appendChild(tableRow)
    table.appendChild(tbody)

    // Assemble the structure: contentArea > collapseWrapper > wrapperInner > table
    wrapperInner.appendChild(table)
    collapseWrapper.appendChild(wrapperInner)
    contentArea.appendChild(collapseWrapper)

    return contentArea
  }

  private positionWindow(overviewElement: HTMLElement): void {
    // Get the transform values of the overview element
    const style = window.getComputedStyle(overviewElement)
    const matrix = new DOMMatrix(style.transform)
    const overviewX = matrix.m41 || 0
    const overviewY = matrix.m42 || 0

    // Position next to the overview element
    const windowX = overviewX + 150 // Offset by overview width
    const windowY = overviewY

    // Apply transform positioning
    this.element!.style.transform = `translate(${windowX}px, ${windowY}px)`
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
    this.element.className = `MuiPaper-root MuiPaper-elevation MuiPaper-elevation1 react-draggable react-draggable-dragged ${CSS_CLASSES.overviewContainer}`

    // Set ID if provided
    if (this.options.id) {
      this.element.id = this.options.id
    }

    // Position the window
    this.positionWindow(overviewElement)

    // Create drag container
    const dragContainer = document.createElement("div")
    dragContainer.className = `drag MuiBox-root ${CSS_CLASSES.dragContainer}`

    // Create and add header
    const header = this.createHeader()
    dragContainer.appendChild(header)

    // Create content area
    const contentArea = this.createContentArea()

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
      `.${CSS_CLASSES.visibilityToggle}`
    ) as HTMLElement
    const collapseSvg = collapseBtn?.querySelector("svg") as SVGElement

    if (contentArea) {
      if (this.isCollapsed) {
        // Collapse: set height to 0 and update classes
        contentArea.style.height = "0px"
        contentArea.style.minHeight = "0px"
        contentArea.className = `MuiCollapse-root MuiCollapse-vertical ${CSS_CLASSES.collapse}`
      } else {
        // Expand: restore height and update classes
        contentArea.style.height = "auto"
        contentArea.style.minHeight = "0px"
        contentArea.className = `MuiCollapse-root MuiCollapse-vertical MuiCollapse-entered ${CSS_CLASSES.collapse}`
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

    // Navigate through the nested structure to find the paragraph in the table header cell
    const contentArea = this.element.children[1] // Second child is content area (MuiCollapse)
    const collapseWrapper = contentArea?.children[0] as HTMLElement // MuiCollapse-wrapper
    const wrapperInner = collapseWrapper?.children[0] as HTMLElement // MuiCollapse-wrapperInner
    const table = wrapperInner?.children[0] as HTMLElement // MuiTable-root
    const tbody = table?.children[0] as HTMLElement // MuiTableBody-root
    const tableRow = tbody?.children[0] as HTMLElement // MuiTableRow-root
    const tableCell = tableRow?.children[0] as HTMLElement // Table header cell
    const paragraph = tableCell?.children[0] as HTMLElement // Paragraph with content

    if (paragraph) {
      paragraph.innerHTML = newContent
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
