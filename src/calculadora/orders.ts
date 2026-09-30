import type { SavedOrder } from './types'
import { ORDERS_KEY } from './types'

export function getSavedOrders(): SavedOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedOrder[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function setSavedOrders(items: SavedOrder[]): void {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(items))
}

export function saveOrder(order: Omit<SavedOrder, 'id' | 'createdAt'>): SavedOrder {
  const item: SavedOrder = {
    ...order,
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
  }
  const orders = getSavedOrders()
  orders.unshift(item)
  setSavedOrders(orders.slice(0, 80))
  return item
}

export function deleteOrder(id: string): void {
  setSavedOrders(getSavedOrders().filter((o) => o.id !== id))
}

export function findOrder(id: string): SavedOrder | undefined {
  return getSavedOrders().find((o) => o.id === id)
}
