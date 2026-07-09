package game;

public abstract class Entity {

    private int health = 100;

    public int getHealth() {
        return health;
    }

    public void damage(int amount) {
        health -= amount;
    }
}
