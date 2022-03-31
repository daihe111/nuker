export const EventPriorities = {

}

export let currentEventPriority: number // 当前触发的事件优先级

/**
 * dom 原生事件 handler 封装器，在模板编译时生成 render 函数时为对应的 dom 元素
 * 绑定 handler 封装器
 * 事件 handler 封装器注入了事件优先级设置逻辑、事件自定义入参
 * @param handler 
 * @param handlerArgs 
 */
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