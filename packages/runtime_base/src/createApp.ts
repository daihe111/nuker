import { Chip, createChip } from "./chip"
import { patch } from "./patch"

export function setupApp(App: any) {
  const appContext = {
    _chip: null,

    render(Component: any, props: object, container: string) {
      const chip1: Chip | null = appContext._chip
      const chip2: Chip | null = createChip(Component, props)
      container = getDomContainer(container)
      patch(chip1, chip2, container)
    },


  }
  return appContext
}