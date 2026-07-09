package game;

public class Player extends Entity implements Movable {

    private String name;
    private Position position;
    private Inventory inventory;

    public Player(String name) {
        this.name = name;
        this.position = new Position(0, 0);
        this.inventory = new Inventory();
    }

    @Override
    public void move(int dx, int dy) {
        position.translate(dx, dy);
    }

    public void pickUp(Item item) {
        inventory.add(item);
    }

    public boolean isAlive() {
        return getHealth() > 0;
    }

    public String getName() {
        return name;
    }
}
