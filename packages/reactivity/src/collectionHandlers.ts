import { ReactiveOptions } from "./reactive";

export function createCollectionHandlers({ isShallow }: ReactiveOptions) {
  return {
    get: createGetter(isShallow),
    set: createSetter(isShallow)
  }
}

function createGetter(isShallow = false) {

}

function createSetter(isShallow = false) {

}