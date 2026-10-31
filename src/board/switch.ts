import { LineBoard, type LineLink } from './line.js';
import { SimBoard } from './sim.js';
import type { Board, Link } from '../types.js';

/**
 * the cloud hub always has a board: the real one when the laptop bridge is
 * connected, the simulator otherwise (also the demo fallback).
 */
export class SwitchBoard implements Board {
  private bridge: LineBoard | null = null;
  private cutCb: (reason: string) => void = () => {};
  private changeCb: () => void = () => {};
  private maxMa = 400;

  constructor(readonly sim: SimBoard) {
    sim.onCut((r) => this.cutCb(r));
  }

  get mode() {
    return this.bridge ? ('serial' as const) : ('sim' as const);
  }
  private get active(): Board {
    return this.bridge ?? this.sim;
  }

  onCut(cb: (reason: string) => void) {
    this.cutCb = cb;
  }
  onChange(cb: () => void) {
    this.changeCb = cb;
  }

  async attach(link: LineLink) {
    const board = new LineBoard(link);
    board.onCut((r) => this.cutCb(r));
    await board.handshake();
    await board.setLimits(this.maxMa).catch(() => {});
    await this.sim.setPower(false);
    this.bridge = board;
    this.changeCb();
  }
  detach() {
    this.bridge = null;
    this.changeCb();
  }

  scan(): Promise<Link[]> {
    return this.active.scan();
  }
  setPower(on: boolean) {
    return this.active.setPower(on);
  }
  status() {
    return this.active.status();
  }
  async setLimits(maxMa: number) {
    this.maxMa = maxMa;
    await this.active.setLimits(maxMa);
  }
}
