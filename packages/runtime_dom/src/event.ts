export const EventPriorities = {

}

export let currentEventPriority: number // 当前触发的事件优先级

export function invokeEventHandler(handler: Function, ...handlerArgs: any[]): void {
  try {
    const eventType: string = (handlerArgs[0] as Event).type
    const prevPriority: number = currentEventPriority
    setCurrentEventPriority(EventPriorities[eventType])
    handler(...handlerArgs)
    setCurrentEventPriority(prevPriority)
  } catch (e) {
    // 事件执行错误，给出警告提示信息
  }
}

export function setCurrentEventPriority(priority: number): number {
  return (currentEventPriority = priority)
}