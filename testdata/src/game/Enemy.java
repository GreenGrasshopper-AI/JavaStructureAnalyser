package game;

public class Enemy extends Entity {

    private Position position = new Position(5, 5);

    public void chase(Player target) {
        position.translate(1, 1);
    }
}
