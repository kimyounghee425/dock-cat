use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn tick_awake(
    xs: &mut [f32],
    ys: &mut [f32],
    speeds: &[f32],
    facings: &[u8],
    movings: &[u8],
    remainings: &mut [f32],
    inactivities: &mut [f32],
    sleep_afters: &[f32],
    max_xs: &[f32],
    jump_actives: &[u8],
    jump_ts: &mut [f32],
    jump_durs: &[f32],
    jump_from_xs: &[f32],
    jump_dxs: &[f32],
    jump_heights: &[f32],
    needs_xstate: &mut [u8],
    dt: f32,
    count: usize,
) {
    for i in 0..count {
        needs_xstate[i] = 0;
        inactivities[i] += dt;
        if inactivities[i] >= sleep_afters[i] {
            needs_xstate[i] = 1;
            continue;
        }

        if jump_actives[i] != 0 {
            let t_new = (jump_ts[i] + dt) / jump_durs[i];
            if t_new >= 1.0 {
                xs[i] = (jump_from_xs[i] + jump_dxs[i]).clamp(0.0, max_xs[i]);
                ys[i] = 0.0;
                needs_xstate[i] = 1;
            } else {
                xs[i] = (jump_from_xs[i] + jump_dxs[i] * t_new).clamp(0.0, max_xs[i]);
                ys[i] = jump_heights[i] * (std::f32::consts::PI * t_new).sin();
                jump_ts[i] += dt;
            }
            remainings[i] -= dt; // awakeTick의 `remaining: context.remaining - dt`와 동일하게
            continue;
        }

        if movings[i] != 0 {
            let dir: f32 = if facings[i] == 1 { 1.0 } else { -1.0 };
            let new_x = xs[i] + speeds[i] * dir * dt;
            if new_x <= 0.0 || new_x >= max_xs[i] {
                xs[i] = new_x.clamp(0.0, max_xs[i]);
                needs_xstate[i] = 1;
                continue;
            }
            xs[i] = new_x;
        }

        remainings[i] -= dt;
        if remainings[i] <= 0.0 {
            needs_xstate[i] = 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        x: f32, y: f32, speed: f32, facing: u8, moving: u8,
        remaining: f32, inactivity: f32, sleep_after: f32, max_x: f32,
        jump_active: u8, jump_t: f32, jump_dur: f32, jump_from_x: f32, jump_dx: f32, jump_height: f32,
        dt: f32,
    ) -> (f32, f32, f32, f32, f32, f32, u8, u8) {
        let mut xs = [x]; let mut ys = [y];
        let speeds = [speed]; let facings = [facing]; let movings = [moving];
        let mut remainings = [remaining]; let mut inactivities = [inactivity];
        let sleep_afters = [sleep_after]; let max_xs = [max_x];
        let jump_actives = [jump_active]; let mut jump_ts = [jump_t];
        let jump_durs = [jump_dur]; let jump_from_xs = [jump_from_x];
        let jump_dxs = [jump_dx]; let jump_heights = [jump_height];
        let mut needs_xstate = [0u8];
        tick_awake(
            &mut xs, &mut ys, &speeds, &facings, &movings,
            &mut remainings, &mut inactivities, &sleep_afters, &max_xs,
            &jump_actives, &mut jump_ts, &jump_durs, &jump_from_xs, &jump_dxs, &jump_heights,
            &mut needs_xstate, dt, 1,
        );
        (xs[0], ys[0], remainings[0], inactivities[0], jump_ts[0], needs_xstate[0] as f32, needs_xstate[0], movings[0])
    }

    #[test]
    fn walk_normal() {
        // 오른쪽으로 걷기, 벽에 안 닿음
        let (x, _, remaining, _, _, _, nx, _) = run(
            100.0, 0.0, 50.0, 1, 1, 1.0, 0.0, 120.0, 1000.0,
            0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.016,
        );
        assert!((x - 100.8).abs() < 0.001, "x={x}");
        assert!((remaining - 0.984).abs() < 0.001);
        assert_eq!(nx, 0); // XState 불필요
    }

    #[test]
    fn walk_hits_wall() {
        // 오른쪽 벽 충돌 → needsXState=1 (999.9 + 50*0.016 = 1000.7 > 1000)
        let (x, _, _, _, _, _, nx, _) = run(
            999.9, 0.0, 50.0, 1, 1, 1.0, 0.0, 120.0, 1000.0,
            0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.016,
        );
        assert_eq!(x, 1000.0);
        assert_eq!(nx, 1);
    }

    #[test]
    fn timer_expires() {
        // remaining 만료 → needsXState=1
        let (_, _, remaining, _, _, _, nx, _) = run(
            100.0, 0.0, 0.0, 0, 0, 0.01, 0.0, 120.0, 1000.0,
            0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.016,
        );
        assert!(remaining < 0.0);
        assert_eq!(nx, 1);
    }

    #[test]
    fn arc_landing() {
        // jump arc 착지(t_new >= 1.0) → needsXState=1, y=0
        // (0.49 + 0.016) / 0.5 = 1.012 >= 1.0 → 착지
        let (x, y, _, _, _, _, nx, _) = run(
            0.0, 0.0, 0.0, 0, 0, 1.0, 0.0, 120.0, 1000.0,
            1, 0.49, 0.5, 100.0, 200.0, 60.0, 0.016,
        );
        assert_eq!(y, 0.0);
        assert_eq!(nx, 1);
        assert!((x - 300.0).abs() < 0.001, "x={x}"); // fromX+dx clamp
    }

    #[test]
    fn sleep_threshold() {
        // inactivity가 sleep_after에 도달 → needsXState=1
        let (_, _, _, _, _, _, nx, _) = run(
            100.0, 0.0, 0.0, 0, 0, 1.0, 119.99, 120.0, 1000.0,
            0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.016,
        );
        assert_eq!(nx, 1);
    }
}
