package game;

import java.util.ArrayList;
import java.util.List;

public class GameLoop {

    private Player player;
    private Board board;
    private List<Enemy> enemies = new ArrayList<>();
    private Entity boss;
    private int tickCount;

    public GameLoop() {
        this.player = new Player("Hero");
        this.board = new Board(20, 15);
    }

    public void update() {
        tickCount++;
        player.move(1, 0);
        board.redraw();
        for (Enemy enemy : enemies) {
            enemy.chase(player);
        }
    }

    public void spawnEnemy() {
        Enemy enemy = new Enemy();
        enemies.add(enemy);
        board.redraw();
    }

    public boolean isRunning() {
        return player.isAlive();
    }
}
