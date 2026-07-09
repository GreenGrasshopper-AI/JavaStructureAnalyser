package game;

import java.util.ArrayList;
import java.util.List;

public class Board {

    private int width;
    private int height;
    private List<Tile> tiles = new ArrayList<>();

    public Board(int width, int height) {
        this.width = width;
        this.height = height;
        for (int i = 0; i < width * height; i++) {
            tiles.add(new Tile());
        }
    }

    public void redraw() {
        for (Tile tile : tiles) {
            tile.render();
        }
    }

    public Tile tileAt(int x, int y) {
        return tiles.get(y * width + x);
    }
}
